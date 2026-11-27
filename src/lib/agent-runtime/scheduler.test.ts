import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyHybridTrace } from '../hybrid-agent/audit';
import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import {
  AGENT_RECOVERY_TASK_NAME,
  MIN_BACKGROUND_INTERVAL_MINUTES,
  recoverAgentRuntimeOnStartup,
  runDueAgentWork,
} from './scheduler';
import { createAgentTask, createAgentTaskSchedule, getAgentTask } from './task-manager';

const mocks = vi.hoisted(() => {
  const chatStore = {
    getConversation: vi.fn(async () => null),
    createConversation: vi.fn(async () => ({ id: 42 })),
    listConversations: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    addMessage: vi.fn(async () => 1),
  };

  return {
    chatStore,
    runAgentTurn: vi.fn(async () => ({
      reply: 'Done.',
      traces: ['checked'],
      artifacts: [],
      toolEvents: [],
      mode: 'system' as const,
      taskId: 'child-1',
      status: 'completed' as const,
      verification: {
        verified: true,
        status: 'verified' as const,
        reason: 'verified',
        evidence: {},
      },
    })),
    recoverStaleRuns: vi.fn(async () => 0),
    loadAiSettings: vi.fn(async () => ({})),
    defineTask: vi.fn<(taskName: string, executor: () => Promise<boolean>) => void>(),
    isTaskRegistered: vi.fn(async (_taskName: string) => false),
    registerTask: vi.fn(async () => undefined),
    getBackgroundStatus: vi.fn(async () => 'Available'),
    registerBackgroundTask: vi.fn<
      (taskName: string, options: { minimumInterval: number }) => Promise<void>
    >(async () => undefined),
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` }));
vi.mock('./background-task-runtime', () => ({
  defineRecoveryTask: (taskName: string, executor: () => Promise<boolean>) => {
    mocks.defineTask(taskName, executor);
  },
  registerRecoveryTask: async (taskName: string, minimumInterval: number) => {
    if ((await mocks.getBackgroundStatus()) !== 'Available') return false;
    if (!(await mocks.isTaskRegistered(taskName))) {
      await mocks.registerBackgroundTask(taskName, { minimumInterval });
    }
    return true;
  },
}));
vi.mock('../ai/settings', () => ({ loadAiSettings: mocks.loadAiSettings }));
vi.mock('../chat', () => ({ getChatStore: () => mocks.chatStore }));
vi.mock('../db', () => ({ DATABASE_NAME: 'orbit-test.db' }));
vi.mock('../permissions/agents', () => ({
  MASTER_AGENT: { id: 'master', name: 'Master', description: '' },
}));
vi.mock('../workflows', () => ({
  runWorkflow: vi.fn(),
  WorkflowStore: class {
    recoverStaleRuns = mocks.recoverStaleRuns;
  },
}));
vi.mock('./orchestrator', () => ({ runAgentTurn: mocks.runAgentTurn }));

const moduleScopeTaskDefinitions = mocks.defineTask.mock.calls.slice();

let db: TestDatabase;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBackgroundStatus.mockResolvedValue('Available');
  mocks.isTaskRegistered.mockResolvedValue(false);
  mocks.runAgentTurn.mockResolvedValue({
    reply: 'Done.',
    traces: ['checked'],
    artifacts: [],
    toolEvents: [],
    mode: 'system',
    taskId: 'child-1',
    status: 'completed',
    verification: { verified: true, status: 'verified', reason: 'verified', evidence: {} },
  });
});

afterEach(() => {
  db?.close();
});

describe('Android agent recovery worker', () => {
  it('registers one inexact background task at module scope', () => {
    expect(moduleScopeTaskDefinitions).toContainEqual([
      AGENT_RECOVERY_TASK_NAME,
      expect.any(Function),
    ]);
    expect(MIN_BACKGROUND_INTERVAL_MINUTES).toBe(15);
  });

  it('runs a due schedule once, persists the task, and does not repeat it', async () => {
    db = createTestDatabase();
    await db.runAsync('INSERT INTO users (id, name) VALUES (?, ?)', 1, 'Asha');
    const schedule = await createAgentTaskSchedule(db, {
      userId: 1,
      ownerType: 'agent_task',
      ownerId: 'manual',
      title: 'Scheduled check',
      input: { instruction: 'Check the workspace', conversationId: 0 },
      nextRunAt: Date.now() - 1_000,
      idempotencyKey: 'schedule:check',
    });

    const first = await runDueAgentWork(db);
    expect(first.executed).toBe(1);
    expect(first.failed).toBe(0);
    expect(mocks.runAgentTurn).toHaveBeenCalledOnce();

    const saved = await db.getFirstAsync<{
      enabled: number;
      task_id: string | null;
      lease_owner: string | null;
    }>('SELECT enabled, task_id, lease_owner FROM agent_task_schedules WHERE id = ?', schedule.id);
    expect(saved?.enabled).toBe(0);
    expect(saved?.task_id).toBeTruthy();
    expect(saved?.lease_owner).toBeNull();

    const task = await getAgentTask(db, saved!.task_id!);
    expect(task?.status).toBe('completed');
    expect(task?.result?.taskId).toBe('child-1');

    const second = await runDueAgentWork(db);
    expect(second.executed).toBe(0);
    expect(mocks.runAgentTurn).toHaveBeenCalledOnce();
  });

  it('forwards data-only bundle ids and records hash-only delivery telemetry', async () => {
    db = createTestDatabase();
    await db.runAsync('INSERT INTO users (id, name) VALUES (?, ?)', 1, 'Asha');
    await createAgentTaskSchedule(db, {
      userId: 1,
      ownerType: 'agent_task',
      ownerId: 'manual',
      title: 'Scheduled check',
      input: {
        instruction: 'Check the workspace',
        conversationId: 0,
        skillBundleIds: ['bundle_research'],
      },
      nextRunAt: Date.now() - 1_000,
      idempotencyKey: 'schedule:bundles',
    });

    const result = await runDueAgentWork(db);
    expect(result.executed).toBe(1);
    expect(mocks.runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ skillBundleIds: ['bundle_research'] })
    );

    const rows = await db.getAllAsync<{
      trace_id: string;
      type: string;
      payload: string;
    }>(
      `SELECT trace_id, type, payload FROM hybrid_audit_events
       WHERE source = 'scheduler' ORDER BY id`
    );
    expect(rows.map((row) => row.type)).toEqual([
      'delivery.queued',
      'delivery.started',
      'delivery.delivered',
    ]);

    const serialised = rows.map((row) => row.payload).join(' ');
    expect(serialised).toContain('bundle_research');
    expect(serialised).toContain('contentHash');
    expect(serialised).not.toContain('Check the workspace');
    expect(serialised).not.toContain('Done.');
    expect(await verifyHybridTrace(db, rows[0].trace_id)).toBe(true);
  });

  it('recovers interrupted work for one user and registers the worker on startup', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, { userId: 1, title: 'Interrupted startup task' });
    await db.raw
      .prepare('UPDATE agent_tasks SET status = ?, lease_until = ? WHERE id = ?')
      .run('running', Date.now() - 1_000, task.id);

    await recoverAgentRuntimeOnStartup(db, 1);

    expect((await getAgentTask(db, task.id))?.status).toBe('needs_review');
    expect(mocks.recoverStaleRuns).toHaveBeenCalledWith(1);
    expect(mocks.registerBackgroundTask).toHaveBeenCalledWith(AGENT_RECOVERY_TASK_NAME, {
      minimumInterval: MIN_BACKGROUND_INTERVAL_MINUTES,
    });
  });
});
