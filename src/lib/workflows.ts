import type { SQLiteDatabase } from 'expo-sqlite';

import { runAgent } from './ai/agent';
import { loadAiSettings } from './ai/settings';
import { getChatStore } from './chat';
import { MASTER_AGENT } from './permissions';
import {
  claimAgentTask,
  createAgentTask,
  createAgentTaskSchedule,
  newAgentTaskId,
  recoverInterruptedAgentTasks,
  setAgentTaskScheduleEnabled,
  updateAgentTaskStatus,
} from './agent-runtime/task-manager';
import type {
  AgentBudget,
  AgentTaskStatus,
  AgentTaskVerification,
  AgentTaskSchedule,
} from './agent-runtime/types';

export type RunStatus = 'running' | 'success' | 'failed';

export type Workflow = {
  id: number;
  name: string;
  instruction: string;
  createdAt: number;
  updatedAt: number;
  runCount: number;
  lastRunAt: number | null;
  lastRunStatus: RunStatus | null;
};

export type WorkflowRun = {
  id: number;
  workflowId: number;
  workflowName: string;
  conversationId: number | null;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  summary: string;
  traces: string[];
  /** Durable orchestration links; older rows may not have them. */
  agentTaskId: string | null;
  scheduleId: string | null;
  agentTaskStatus: AgentTaskStatus | null;
  verification: AgentTaskVerification | null;
};

export const WORKFLOW_NAME_MAX = 60;
export const WORKFLOW_INSTRUCTION_MAX = 1000;

/** A run that is still "running" after this long was interrupted (app closed). */
const STALE_RUN_MS = 10 * 60 * 1000;
const WORKFLOW_LEASE_MS = 10 * 60_000;

type WorkflowRow = {
  id: number;
  name: string;
  instruction: string;
  created_at: number;
  updated_at: number;
  run_count: number;
  last_run_at: number | null;
  last_run_status: string | null;
};

type RunRow = {
  id: number;
  workflow_id: number;
  workflow_name: string;
  conversation_id: number | null;
  status: string;
  started_at: number;
  finished_at: number | null;
  summary: string;
  traces: string;
  agent_task_id: string | null;
  schedule_id: string | null;
  agent_task_status: string | null;
  verification_json: string | null;
};

function toRunStatus(value: string | null): RunStatus | null {
  return value === 'running' || value === 'success' || value === 'failed' ? value : null;
}

function toAgentTaskStatus(value: string | null): AgentTaskStatus | null {
  const valid: AgentTaskStatus[] = [
    'queued',
    'running',
    'awaiting_approval',
    'awaiting_tool',
    'blocked',
    'paused',
    'needs_review',
    'completed',
    'failed',
    'cancelled',
    'unknown',
  ];
  return valid.includes(value as AgentTaskStatus) ? (value as AgentTaskStatus) : null;
}

function parseTraces(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;

    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseVerification(raw: string | null): AgentTaskVerification | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AgentTaskVerification;
    return typeof value?.verified === 'boolean' && typeof value.reason === 'string' ? value : null;
  } catch {
    return null;
  }
}

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    lastRunStatus: toRunStatus(row.last_run_status),
  };
}

function mapRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    conversationId: row.conversation_id,
    status: toRunStatus(row.status) ?? 'failed',
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: row.summary,
    traces: parseTraces(row.traces),
    agentTaskId: row.agent_task_id,
    scheduleId: row.schedule_id,
    agentTaskStatus: toAgentTaskStatus(row.agent_task_status),
    verification: parseVerification(row.verification_json),
  };
}

/** Returns an error message, or null when the draft is valid. */
export function validateWorkflowDraft(name: string, instruction: string): string | null {
  const cleanName = name.trim();
  const cleanInstruction = instruction.trim();

  if (!cleanName) {
    return 'Give the workflow a name.';
  }

  if (cleanName.length > WORKFLOW_NAME_MAX) {
    return `The name can be at most ${WORKFLOW_NAME_MAX} characters.`;
  }

  if (!cleanInstruction) {
    return 'Describe what the workflow should do.';
  }

  if (cleanInstruction.length > WORKFLOW_INSTRUCTION_MAX) {
    return `The instruction can be at most ${WORKFLOW_INSTRUCTION_MAX} characters.`;
  }

  return null;
}

const WORKFLOW_SELECT = `
  SELECT w.id, w.name, w.instruction, w.created_at, w.updated_at,
    (SELECT COUNT(*) FROM workflow_runs r WHERE r.workflow_id = w.id) AS run_count,
    (SELECT r.started_at FROM workflow_runs r WHERE r.workflow_id = w.id ORDER BY r.id DESC LIMIT 1) AS last_run_at,
    (SELECT r.status FROM workflow_runs r WHERE r.workflow_id = w.id ORDER BY r.id DESC LIMIT 1) AS last_run_status
  FROM workflows w
`;

const RUN_SELECT = `
  SELECT r.id, r.workflow_id, w.name AS workflow_name, r.conversation_id, r.status,
    r.started_at, r.finished_at, r.summary, r.traces,
    r.agent_task_id, r.schedule_id,
    t.status AS agent_task_status, t.verification_json
  FROM workflow_runs r
  JOIN workflows w ON w.id = r.workflow_id
  LEFT JOIN agent_tasks t ON t.id = r.agent_task_id
`;

export class WorkflowStore {
  constructor(private db: SQLiteDatabase) {}

  async list(userId: number): Promise<Workflow[]> {
    const rows = await this.db.getAllAsync<WorkflowRow>(
      `${WORKFLOW_SELECT} WHERE w.user_id = ? ORDER BY w.updated_at DESC`,
      userId
    );

    return rows.map(mapWorkflow);
  }

  async create(userId: number, name: string, instruction: string): Promise<number> {
    const now = Date.now();
    const result = await this.db.runAsync(
      'INSERT INTO workflows (user_id, name, instruction, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      userId,
      name.trim(),
      instruction.trim(),
      now,
      now
    );

    return result.lastInsertRowId;
  }

  async update(userId: number, id: number, name: string, instruction: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE workflows SET name = ?, instruction = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      name.trim(),
      instruction.trim(),
      Date.now(),
      id,
      userId
    );
  }

  async remove(userId: number, id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM workflows WHERE id = ? AND user_id = ?', id, userId);
  }

  async listRuns(userId: number, limit = 30): Promise<WorkflowRun[]> {
    const rows = await this.db.getAllAsync<RunRow>(
      `${RUN_SELECT} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT ?`,
      userId,
      limit
    );

    return rows.map(mapRun);
  }

  async getRun(userId: number, id: number): Promise<WorkflowRun | null> {
    const row = await this.db.getFirstAsync<RunRow>(
      `${RUN_SELECT} WHERE r.user_id = ? AND r.id = ?`,
      userId,
      id
    );

    return row ? mapRun(row) : null;
  }

  async startRun(
    userId: number,
    workflowId: number,
    conversationId: number,
    agentTaskId: string | null = null,
    scheduleId: string | null = null
  ): Promise<number> {
    const result = await this.db.runAsync(
      `INSERT INTO workflow_runs (
        user_id, workflow_id, conversation_id, status, started_at, agent_task_id, schedule_id
      ) VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      userId,
      workflowId,
      conversationId,
      Date.now(),
      agentTaskId,
      scheduleId
    );

    return result.lastInsertRowId;
  }

  async finishRun(
    id: number,
    status: Exclude<RunStatus, 'running'>,
    summary: string,
    traces: string[]
  ): Promise<void> {
    await this.db.runAsync(
      'UPDATE workflow_runs SET status = ?, finished_at = ?, summary = ?, traces = ? WHERE id = ?',
      status,
      Date.now(),
      summary.slice(0, 4000),
      JSON.stringify(traces),
      id
    );
  }

  /**
   * Recovers from the durable task ledger, not from an in-memory Set. Task
   * leases and verification state are the source of truth; legacy runs without
   * a task id still use the old stale-time rule.
   */
  async recoverStaleRuns(userId?: number): Promise<number> {
    const now = Date.now();
    await recoverInterruptedAgentTasks(this.db, { now, staleMs: STALE_RUN_MS });

    const scope = userId === undefined ? '' : 'AND r.user_id = ?';
    const legacyScope = userId === undefined ? '' : 'AND user_id = ?';
    const params = userId === undefined ? [] : [userId];
    const interrupted = await this.db.getAllAsync<{
      id: number;
      error: string | null;
      title: string;
    }>(
      `SELECT r.id, t.error, t.title
       FROM workflow_runs r
       JOIN agent_tasks t ON t.id = r.agent_task_id
       WHERE r.status = 'running'
         AND t.status IN ('needs_review', 'failed', 'cancelled', 'unknown')
         ${scope}`,
      ...params
    );

    for (const row of interrupted) {
      await this.db.runAsync(
        `UPDATE workflow_runs
         SET status = 'failed', finished_at = ?, summary = ?
         WHERE id = ?`,
        now,
        `Interrupted before verification: ${row.error || row.title || 'the task ended early'}`,
        row.id
      );
    }

    const legacy = await this.db.runAsync(
      `UPDATE workflow_runs
       SET status = 'failed', finished_at = ?,
           summary = 'Interrupted — the app was closed before this run finished.'
       WHERE status = 'running' AND agent_task_id IS NULL AND started_at < ?
         ${legacyScope}`,
      now,
      now - STALE_RUN_MS,
      ...params
    );

    return interrupted.length + legacy.changes;
  }
}

export type WorkflowRunOptions = {
  /** Deterministic key used by scheduler/background retries. */
  idempotencyKey?: string;
  scheduleId?: string | null;
  conversationId?: number;
  signal?: AbortSignal;
  budget?: AgentBudget;
};

async function getWorkflow(
  db: SQLiteDatabase,
  userId: number,
  workflowId: number
): Promise<Workflow | null> {
  const row = await db.getFirstAsync<WorkflowRow>(
    `${WORKFLOW_SELECT} WHERE w.id = ? AND w.user_id = ?`,
    workflowId,
    userId
  );
  return row ? mapWorkflow(row) : null;
}

/**
 * Runs a workflow once through the same durable orchestrator as chat. The
 * workflow task, its run row and the child agent turn are all persisted, so an
 * app restart can recover the run instead of silently losing it.
 */
export async function runWorkflow(
  db: SQLiteDatabase,
  user: { id: number; name: string },
  workflow: Pick<Workflow, 'id' | 'name' | 'instruction'>,
  options: WorkflowRunOptions = {}
): Promise<WorkflowRun> {
  const chat = getChatStore(db);
  const store = new WorkflowStore(db);
  const projectId = `workflow-${workflow.id}`;
  const conversation =
    options.conversationId !== undefined
      ? await chat.getConversation(user.id, options.conversationId)
      : null;
  const targetConversation =
    conversation ??
    (await chat.createConversation(user.id, `Workflow: ${workflow.name}`, MASTER_AGENT.id));

  const task = await createAgentTask(db, {
    userId: user.id,
    conversationId: targetConversation.id,
    projectId,
    kind: 'workflow',
    title: `Workflow: ${workflow.name}`,
    input: {
      workflowId: workflow.id,
      instruction: workflow.instruction,
      conversationId: targetConversation.id,
      scheduleId: options.scheduleId ?? null,
    },
    budget: options.budget,
    idempotencyKey:
      options.idempotencyKey ?? `workflow:${workflow.id}:${newAgentTaskId('run')}`,
  });

  const claimed = await claimAgentTask(db, task.id, `workflow_${task.id}`, WORKFLOW_LEASE_MS);

  if (!claimed) {
    throw new Error('This workflow is already running.');
  }

  let runId: number | null = null;

  try {
    await chat.addMessage(user.id, targetConversation.id, 'user', workflow.instruction);
    runId = await store.startRun(
      user.id,
      workflow.id,
      targetConversation.id,
      task.id,
      options.scheduleId ?? null
    );

    const settings = await loadAiSettings();
    const result = await runAgent({
      db,
      userId: user.id,
      userName: user.name,
      history: [{ role: 'user', content: workflow.instruction }],
      settings,
      conversationId: targetConversation.id,
      agent: MASTER_AGENT,
      projectId,
      projectLabel: `Workflow: ${workflow.name}`,
      parentTaskId: task.id,
      signal: options.signal,
      budget: options.budget,
    });

    const completed = result.status === 'completed' && result.verification.verified;
    const summary = completed
      ? result.reply
      : `Needs review — ${result.verification.reason || result.status}. ${result.reply}`.trim();

    await chat.addMessage(user.id, targetConversation.id, 'assistant', result.reply, result.traces, result.artifacts, {
      agentTaskId: result.taskId,
      agentStatus: result.status,
      agentVerified: result.verification.verified,
      verification: result.verification,
    });
    await updateAgentTaskStatus(db, task.id, completed ? 'completed' : 'needs_review', {
      phase: completed ? 'done' : 'verify',
      result: { reply: result.reply, childTaskId: result.taskId },
      verification: result.verification,
      error: completed ? null : summary,
      finishedAt: Date.now(),
      leaseOwner: null,
      leaseUntil: null,
    });
    await store.finishRun(runId, completed ? 'success' : 'failed', summary, result.traces);
  } catch (runError) {
    const message = runError instanceof Error ? runError.message : 'The workflow failed.';

    await updateAgentTaskStatus(db, task.id, 'needs_review', {
      phase: 'verify',
      verification: {
        verified: false,
        status: 'uncertain',
        reason: message,
        evidence: { interrupted: true, workflowId: workflow.id },
      },
      error: message,
      finishedAt: Date.now(),
      leaseOwner: null,
      leaseUntil: null,
    });

    if (runId !== null) {
      await store.finishRun(runId, 'failed', `Interrupted — ${message}`, []);
      const finished = await store.getRun(user.id, runId);
      if (finished) return finished;
    }
    throw runError;
  }

  const finished = await store.getRun(user.id, runId as number);
  if (!finished) {
    throw new Error('The run finished but could not be loaded.');
  }

  return finished;
}

/** Creates an idempotent schedule that the Android worker can execute. */
export async function scheduleWorkflow(
  db: SQLiteDatabase,
  userId: number,
  workflowId: number,
  nextRunAt: number,
  intervalMs: number | null = null
): Promise<AgentTaskSchedule> {
  const workflow = await getWorkflow(db, userId, workflowId);
  if (!workflow) throw new Error('That workflow was not found.');

  return createAgentTaskSchedule(db, {
    userId,
    ownerType: 'workflow',
    ownerId: String(workflowId),
    title: `Workflow: ${workflow.name}`,
    input: { workflowId: workflow.id, instruction: workflow.instruction },
    intervalMs,
    nextRunAt,
    idempotencyKey: `workflow:${workflowId}:${nextRunAt}`,
  });
}

export async function cancelWorkflowSchedule(
  db: SQLiteDatabase,
  scheduleId: string
): Promise<void> {
  await setAgentTaskScheduleEnabled(db, scheduleId, false);
}
