import type { SQLiteDatabase } from 'expo-sqlite';

import {
  appendAgentTaskEvent,
  getAgentTask,
  recoverInterruptedAgentTasks,
  updateAgentTaskStatus,
} from '../agent-runtime/task-manager';
import { fromLegacyStatus } from './state';
import { recordHybridEvent } from './audit';
import type { HybridTaskState } from './types';

export type HybridRecoveryResult = {
  requeued: number;
  blocked: number;
  schedules: number;
};

type StaleRow = {
  id: string;
  user_id: number;
  hybrid_state: string | null;
  status: string;
  lease_until: number | null;
  updated_at: number;
};

/**
 * Hybrid-aware startup recovery. Safe work with no recorded action is
 * requeued; anything with possible side effects is blocked for review. Pending
 * approvals are never auto-approved after a restart.
 */
export async function recoverHybridAgentTasks(
  db: SQLiteDatabase,
  options: { now?: number; staleMs?: number; userId?: number; traceId?: string } = {}
): Promise<HybridRecoveryResult> {
  const now = options.now ?? Date.now();
  const staleBefore = now - (options.staleMs ?? 10 * 60_000);
  const traceId = options.traceId ?? 'startup';

  const params: (string | number)[] = [staleBefore, staleBefore];
  let userClause = '';
  if (options.userId !== undefined) {
    userClause = ' AND user_id = ?';
    params.push(options.userId);
  }

  const rows = (await db.getAllAsync(
    `SELECT id, user_id, hybrid_state, status, lease_until, updated_at
     FROM agent_tasks
     WHERE hybrid_state IN ('PLANNING', 'RUNNING', 'WAITING_FOR_APPROVAL', 'VERIFYING')
       AND (lease_until IS NULL OR lease_until <= ? OR updated_at <= ?)${userClause}`,
    ...params
  )) as StaleRow[];

  let requeued = 0;
  let blocked = 0;

  for (const row of rows) {
    const task = await getAgentTask(db, row.id);
    if (!task) continue;

    const state: HybridTaskState = task.hybridState ?? fromLegacyStatus(task.status);
    const attempts = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM agent_task_attempts WHERE task_id = ?',
      row.id
    );
    const hasSideEffects = (attempts?.count ?? 0) > 0;

    const nextState: HybridTaskState =
      state === 'WAITING_FOR_APPROVAL' || state === 'VERIFYING' || hasSideEffects
        ? 'BLOCKED'
        : 'QUEUED';

    await updateAgentTaskStatus(db, row.id, nextState === 'QUEUED' ? 'queued' : 'blocked', {
      hybridState: nextState,
      phase: nextState === 'QUEUED' ? 'system' : 'verify',
      traceId,
      leaseOwner: null,
      leaseUntil: null,
      error:
        nextState === 'BLOCKED'
          ? 'Recovered after interruption; external effects may have occurred.'
          : null,
      finishedAt: nextState === 'BLOCKED' ? now : null,
    });

    await appendAgentTaskEvent(db, {
      taskId: row.id,
      userId: row.user_id,
      type: 'task.recovered',
      payload: { from: state, to: nextState, hasSideEffects },
      createdAt: now,
    });

    await recordHybridEvent(db, {
      traceId,
      taskId: row.id,
      userId: row.user_id,
      source: 'recovery',
      type: nextState === 'QUEUED' ? 'task.requeued' : 'task.blocked',
      payload: { from: state, to: nextState, hasSideEffects },
    });

    if (nextState === 'QUEUED') requeued += 1;
    else blocked += 1;
  }

  const legacy = await recoverInterruptedAgentTasks(db, { now, staleMs: options.staleMs ?? 10 * 60_000 });

  return { requeued, blocked, schedules: legacy.schedules };
}
