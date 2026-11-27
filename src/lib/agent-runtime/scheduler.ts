import * as BackgroundTask from 'expo-background-task';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { loadAiSettings } from '../ai/settings';
import { getChatStore } from '../chat';
import { DATABASE_NAME } from '../db';
import { MASTER_AGENT } from '../permissions/agents';
import type { AgentIdentity } from '../permissions/types';
import { runWorkflow, WorkflowStore } from '../workflows';

import { runAgentTurn } from './orchestrator';
import {
  claimAgentTask,
  claimDueAgentTaskSchedules,
  completeAgentTaskSchedule,
  createAgentTask,
  getAgentTask,
  recoverInterruptedAgentTasks,
  updateAgentTaskStatus,
} from './task-manager';
import type { AgentBudget, AgentTaskSchedule, CapabilityGrant } from './types';
import { hashChain } from './hash';

export const AGENT_RECOVERY_TASK_NAME = 'orbit-agent-recovery';
export const MIN_BACKGROUND_INTERVAL_MINUTES = 15;
const SCHEDULE_LEASE_MS = 10 * 60_000;

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function executeWorkflowSchedule(
  db: SQLiteDatabase,
  schedule: AgentTaskSchedule,
  owner: string,
  userName: string
): Promise<void> {
  const rawId = schedule.input.workflowId ?? schedule.ownerId;
  const workflowId = typeof rawId === 'number' ? rawId : Number(rawId);

  if (!Number.isInteger(workflowId) || workflowId <= 0) {
    await completeAgentTaskSchedule(db, schedule.id, {
      nextRunAt: schedule.nextRunAt,
      disable: true,
    });
    return;
  }

  const workflow = await db.getFirstAsync<{ id: number; name: string; instruction: string }>(
    'SELECT id, name, instruction FROM workflows WHERE id = ? AND user_id = ?',
    workflowId,
    schedule.userId
  );

  if (!workflow) {
    await completeAgentTaskSchedule(db, schedule.id, {
      nextRunAt: schedule.nextRunAt,
      disable: true,
    });
    return;
  }

  const conversationId = numberValue(schedule.input.conversationId, 0);
  const run = await runWorkflow(
    db,
    { id: schedule.userId, name: userName },
    { id: workflow.id, name: workflow.name, instruction: workflow.instruction },
    {
      idempotencyKey: schedule.idempotencyKey,
      scheduleId: schedule.id,
      ...(conversationId > 0 ? { conversationId } : {}),
      budget: (schedule.input.budget as AgentBudget | undefined) ?? undefined,
    }
  );

  if (run.agentTaskId) {
    await db.runAsync(
      'UPDATE agent_task_schedules SET task_id = ?, lease_owner = ?, lease_until = ? WHERE id = ?',
      run.agentTaskId,
      owner,
      Date.now() + SCHEDULE_LEASE_MS,
      schedule.id
    );
  }

  const completed = run.status === 'success';
  await completeAgentTaskSchedule(db, schedule.id, {
    completedAt: Date.now(),
    nextRunAt: schedule.intervalMs
      ? schedule.nextRunAt + schedule.intervalMs
      : Date.now(),
    disable: !schedule.intervalMs || !completed,
  });
}

/**
 * Android WorkManager invokes this through a single persistent worker. The
 * callback must be registered at module scope so a background launch finds it
 * before any React component mounts. No iOS background mode is implemented.
 */
if (Platform.OS === 'android') {
  TaskManager.defineTask(AGENT_RECOVERY_TASK_NAME, async () => {
    try {
      await runDueAgentWork();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      console.warn('ORBIT background recovery failed.', error);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Registers the inexact, battery-aware worker. Safe to call on every launch. */
export async function registerAgentRecoveryBackgroundTask(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;

    if (!(await TaskManager.isTaskRegisteredAsync(AGENT_RECOVERY_TASK_NAME))) {
      // WorkManager treats this as a minimum delay, not an exact alarm. The OS
      // may wake the worker later to batch wakeups.
      await BackgroundTask.registerTaskAsync(AGENT_RECOVERY_TASK_NAME, {
        minimumInterval: MIN_BACKGROUND_INTERVAL_MINUTES,
      });
    }

    return true;
  } catch (error) {
    console.warn('Could not register the ORBIT background worker.', error);
    return false;
  }
}

async function executeSchedule(
  db: SQLiteDatabase,
  schedule: AgentTaskSchedule,
  owner: string
): Promise<void> {
  const user = (await db.getFirstAsync<{ id: number; name: string }>(
    'SELECT id, name FROM users WHERE id = ?',
    schedule.userId
  )) as { id: number; name: string } | null;

  if (!user) {
    await completeAgentTaskSchedule(db, schedule.id, {
      nextRunAt: schedule.nextRunAt,
      disable: true,
    });
    return;
  }

  if (schedule.ownerType === 'workflow') {
    await executeWorkflowSchedule(db, schedule, owner, user.name);
    return;
  }

  let task = schedule.taskId ? await getAgentTask(db, schedule.taskId) : null;
  const idempotencyKey = `schedule:${schedule.id}:${schedule.nextRunAt}`;

  if (!task) {
    task = await createAgentTask(db, {
      userId: schedule.userId,
      conversationId: null,
      projectId: stringValue(schedule.input.projectId, `schedule-${schedule.id}`),
      kind: 'scheduled',
      title: schedule.title,
      input: { ...schedule.input, scheduleId: schedule.id },
      budget: (schedule.input.budget as AgentBudget | undefined) ?? undefined,
      grants: (schedule.input.grants as CapabilityGrant[] | undefined) ?? [],
      idempotencyKey,
      nextRunAt: schedule.nextRunAt,
    });
    await db.runAsync(
      'UPDATE agent_task_schedules SET task_id = ? WHERE id = ?',
      task.id,
      schedule.id
    );
  }

  if (task.status === 'completed') {
    await completeAgentTaskSchedule(db, schedule.id, {
      completedAt: Date.now(),
      nextRunAt: schedule.intervalMs
        ? schedule.nextRunAt + schedule.intervalMs
        : Date.now(),
      disable: !schedule.intervalMs,
    });
    return;
  }

  const claimed =
    task.status === 'queued' || task.status === 'needs_review'
      ? await claimAgentTask(db, task.id, owner, SCHEDULE_LEASE_MS)
      : task;

  if (!claimed || (claimed.status !== 'running' && claimed.leaseOwner !== owner)) {
    return;
  }

  const instruction = stringValue(
    schedule.input.instruction ?? schedule.input.text,
    schedule.title
  );
  const conversationId = numberValue(schedule.input.conversationId, 0);
  const conversation =
    conversationId > 0
      ? await getChatStore(db).getConversation(schedule.userId, conversationId)
      : null;
  const targetConversation =
    conversation ??
    (await getChatStore(db).createConversation(
      schedule.userId,
      schedule.title.slice(0, 80) || 'Scheduled run',
      MASTER_AGENT.id
    ));
  const agent: AgentIdentity = MASTER_AGENT;

  try {
    const result = await runAgentTurn({
      db,
      userId: schedule.userId,
      userName: user.name || 'User',
      history: [{ role: 'user', content: instruction }],
      settings: await loadAiSettings(),
      conversationId: targetConversation.id,
      agent,
      projectId: stringValue(
        schedule.input.projectId,
        `schedule-${schedule.id}`
      ),
      projectLabel: schedule.title || 'Scheduled run',
      parentTaskId: task.id,
      grants: claimed.grants,
      budget: claimed.budget,
    });

    const completed = result.status === 'completed' && result.verification.verified;
    await updateAgentTaskStatus(db, task.id, completed ? 'completed' : 'needs_review', {
      phase: completed ? 'done' : 'verify',
      result: { reply: result.reply, taskId: result.taskId },
      verification: result.verification,
      error: completed ? null : 'The scheduled run did not return verified completion.',
      finishedAt: Date.now(),
      leaseOwner: null,
      leaseUntil: null,
    });

    await completeAgentTaskSchedule(db, schedule.id, {
      completedAt: Date.now(),
      nextRunAt: schedule.intervalMs
        ? schedule.nextRunAt + schedule.intervalMs
        : Date.now(),
      disable: !schedule.intervalMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduled run failed.';
    await updateAgentTaskStatus(db, task.id, 'needs_review', {
      phase: 'verify',
      verification: {
        verified: false,
        status: 'uncertain',
        reason: message,
        evidence: { interrupted: true },
      },
      error: message,
      finishedAt: Date.now(),
      leaseOwner: null,
      leaseUntil: null,
    });
    await completeAgentTaskSchedule(db, schedule.id, {
      completedAt: Date.now(),
      nextRunAt: Date.now() + 15 * 60_000,
      disable: !schedule.intervalMs,
    });
    throw error;
  }
}

export type BackgroundWorkResult = {
  recoveredTasks: number;
  recoveredSchedules: number;
  executed: number;
  failed: number;
};

/** Recovers interrupted work and runs every due, leased schedule once. */
export async function runDueAgentWork(
  providedDb?: SQLiteDatabase
): Promise<BackgroundWorkResult> {
  const ownsDb = !providedDb;
  const db =
    providedDb ??
    (await SQLite.openDatabaseAsync(DATABASE_NAME, { enableChangeListener: false }));
  const owner = `background_${hashChain({ at: Date.now() }).slice(0, 12)}`;

  try {
    const recovered = await recoverInterruptedAgentTasks(db, { owner });
    await new WorkflowStore(db).recoverStaleRuns();
    const schedules = await claimDueAgentTaskSchedules(db, owner, Date.now(), SCHEDULE_LEASE_MS, 5);

    let executed = 0;
    let failed = 0;
    for (const schedule of schedules) {
      try {
        await executeSchedule(db, schedule, owner);
        executed += 1;
      } catch (error) {
        failed += 1;
        console.warn(`Scheduled ORBIT run ${schedule.id} failed.`, error);
      }
    }

    return {
      recoveredTasks: recovered.tasks,
      recoveredSchedules: recovered.schedules,
      executed,
      failed,
    };
  } finally {
    if (ownsDb) {
      await db.closeAsync().catch(() => {
        // The OS may have already torn down the connection.
      });
    }
  }
}

/** Foreground startup recovery; the worker covers later app-closed periods. */
export async function recoverAgentRuntimeOnStartup(
  db: SQLiteDatabase,
  userId?: number
): Promise<void> {
  await recoverInterruptedAgentTasks(db);
  await new WorkflowStore(db).recoverStaleRuns(userId);
  await registerAgentRecoveryBackgroundTask();
}
