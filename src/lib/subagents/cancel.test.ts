import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { SubagentExecutor } from '../subagents';

vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` }));
vi.mock('./runtime', () => ({ runSubagentTask: vi.fn() }));

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

async function seed(agentTaskId: string, subagentTaskId: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO agent_tasks (id, user_id, status, phase, created_at, updated_at)
     VALUES (?, 1, 'running', 'ai', ?, ?)`,
    agentTaskId,
    now,
    now
  );
  await db.runAsync(
    `INSERT INTO subagent_tasks (id, name, description, status, input, created_at)
     VALUES (?, 'Delegated', 'cancel test', 'running', ?, ?)`,
    subagentTaskId,
    JSON.stringify({ agentTaskId }),
    now
  );
}

describe('subagent cancellation state', () => {
  it('cancels an untouched agent task and records the AbortController limitation', async () => {
    db = createTestDatabase();
    await seed('task-1', 'subtask-1');

    await new SubagentExecutor(db).cancelTask('subtask-1');

    const task = await db.getFirstAsync<{ status: string; phase: string; result_json: string }>(
      'SELECT status, phase, result_json FROM agent_tasks WHERE id = ?',
      'task-1'
    );
    expect(task?.status).toBe('cancelled');
    expect(task?.phase).toBe('verify');
    expect(JSON.parse(task?.result_json ?? '{}').metadata).toMatchObject({
      abortControllerAvailable: false,
      sideEffectsRecorded: false,
    });
    expect(JSON.parse(task?.result_json ?? '{}').metadata.limitation).toContain('AbortController');

    const legacy = await db.getFirstAsync<{ status: string }>(
      'SELECT status FROM subagent_tasks WHERE id = ?',
      'subtask-1'
    );
    expect(legacy?.status).toBe('cancelled');
  });

  it('requires review after a recorded side effect', async () => {
    db = createTestDatabase();
    await seed('task-2', 'subtask-2');
    await db.runAsync(
      `INSERT INTO agent_task_attempts
        (id, task_id, attempt, tool_name, status, started_at, duration_ms)
       VALUES ('attempt-1', 'task-2', 1, 'list_tasks', 'success', ?, 0)`,
      Date.now()
    );

    await new SubagentExecutor(db).cancelTask('subtask-2');

    const task = await db.getFirstAsync<{ status: string; result_json: string }>(
      'SELECT status, result_json FROM agent_tasks WHERE id = ?',
      'task-2'
    );
    expect(task?.status).toBe('needs_review');
    expect(JSON.parse(task?.result_json ?? '{}').metadata.sideEffectsRecorded).toBe(true);
  });
});
