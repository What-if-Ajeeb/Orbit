import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentTask, updateAgentTaskStatus } from './agent-runtime/task-manager';
import { createTestDatabase, type TestDatabase } from './testing/node-sqlite';
import { WorkflowStore } from './workflows';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` }));
vi.mock('./ai/agent', () => ({ runAgent: vi.fn() }));
vi.mock('./ai/settings', () => ({ loadAiSettings: vi.fn(async () => ({})) }));
vi.mock('./chat', () => ({ getChatStore: vi.fn(() => ({})) }));
vi.mock('./permissions', () => ({ MASTER_AGENT: { id: 'master', name: 'Master' } }));

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

async function seedWorkflow(userId = 1): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO workflows (user_id, name, instruction) VALUES (?, ?, ?)',
    userId,
    'Daily review',
    'Review the workspace.'
  );
  return Number(result.lastInsertRowId);
}

describe('durable workflow recovery', () => {
  it('fails a run whose durable task ended without verified completion', async () => {
    db = createTestDatabase();
    const workflowId = await seedWorkflow();
    const store = new WorkflowStore(db);
    const task = await createAgentTask(db, {
      userId: 1,
      title: 'Workflow: Daily review',
      kind: 'workflow',
    });
    await updateAgentTaskStatus(db, task.id, 'needs_review', {
      error: 'Interrupted before verification.',
    });
    const runId = await store.startRun(1, workflowId, 10, task.id, 'schedule-1');

    expect(await store.recoverStaleRuns(1)).toBe(1);
    const run = await store.getRun(1, runId);

    expect(run?.status).toBe('failed');
    expect(run?.summary).toMatch(/Interrupted before verification/);
    expect(run?.agentTaskId).toBe(task.id);
    expect(run?.scheduleId).toBe('schedule-1');
    expect(run?.agentTaskStatus).toBe('needs_review');
  });

  it('recovers legacy runs and supports all-user background recovery', async () => {
    db = createTestDatabase();
    const workflowId = await seedWorkflow(1);
    const store = new WorkflowStore(db);
    const old = Date.now() - 30 * 60_000;
    await db.runAsync(
      `INSERT INTO workflow_runs
        (user_id, workflow_id, conversation_id, status, started_at, summary, traces)
       VALUES (?, ?, ?, 'running', ?, '', '[]')`,
      1,
      workflowId,
      10,
      old
    );

    expect(await store.recoverStaleRuns()).toBe(1);
    const runs = await store.listRuns(1);
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.summary).toMatch(/app was closed/i);
  });
});
