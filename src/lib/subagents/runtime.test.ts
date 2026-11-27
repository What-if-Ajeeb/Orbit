import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { runSubagentTask } from './runtime';

const mocks = vi.hoisted(() => ({
  runAgentTurn: vi.fn(),
  agentIdentityForSubagent: vi.fn((row: { id: string; name: string }) => ({
    id: `subagent_${row.id}`,
    name: row.name,
    description: 'Delegated agent',
  })),
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` }));
vi.mock('../ai/tool-registry', () => ({
  agentToolRegistry: {
    get: (name: string) =>
      ['list_tasks', 'artifact_read'].includes(name) ? { definition: { name } } : null,
  },
}));
vi.mock('../ai/settings', () => ({ loadAiSettings: vi.fn(async () => ({})) }));
vi.mock('../permissions/agents', () => ({
  MASTER_AGENT: { id: 'master', name: 'Master', description: '' },
  agentIdentityForSubagent: mocks.agentIdentityForSubagent,
}));
vi.mock('../agent-runtime/orchestrator', () => ({ runAgentTurn: mocks.runAgentTurn }));

let db: TestDatabase;

const verifiedResult = {
  reply: 'Delegated work is done.',
  traces: ['checked'],
  artifacts: [],
  toolEvents: [],
  mode: 'system' as const,
  taskId: 'child-task',
  status: 'completed' as const,
  verification: {
    verified: true,
    status: 'verified' as const,
    reason: 'verified',
    evidence: {},
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runAgentTurn.mockResolvedValue(verifiedResult);
});

afterEach(() => {
  db?.close();
});

async function seedSubagent(capabilities: string[], enabled = 1): Promise<void> {
  await db.runAsync(
    `INSERT INTO subagents
      (id, name, description, version, capabilities, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'researcher',
    'Researcher',
    'Read-only research',
    '1.0.0',
    JSON.stringify(capabilities),
    enabled,
    Date.now(),
    Date.now()
  );
}

describe('isolated subagent delegation', () => {
  it('passes only explicit registered grants and a separate child identity', async () => {
    db = createTestDatabase();
    await seedSubagent(['list_tasks', 'artifact_read', 'unregistered_capability']);

    const result = await runSubagentTask(db, {
      userId: 1,
      userName: 'Asha',
      subagentId: 'researcher',
      instruction: 'List the current tasks.',
      requestedTools: ['list_tasks', 'artifact_read'],
    });

    const turnInput = mocks.runAgentTurn.mock.calls[0]?.[0];
    expect(turnInput.agent.id).toBe('subagent_researcher');
    expect(turnInput.agent.id).not.toBe('master');
    expect(turnInput.grants.map((grant: { toolName: string }) => grant.toolName)).toEqual([
      'list_tasks',
      'artifact_read',
    ]);
    expect(turnInput.budget.maxSubagentDepth).toBe(0);
    expect(result.subagentTaskId).toMatch(/^subtask_/);
    expect(result.agentTaskId).toBeTruthy();

    const grants = await db.getAllAsync<{ status: string }>(
      'SELECT status FROM subagent_grants WHERE parent_task_id = ?',
      result.agentTaskId
    );
    expect(grants).toHaveLength(2);
    expect(grants.every((grant) => grant.status === 'revoked')).toBe(true);
  });

  it('rejects a tool outside the declared capabilities before running a child turn', async () => {
    db = createTestDatabase();
    await seedSubagent(['list_tasks']);

    await expect(
      runSubagentTask(db, {
        userId: 1,
        userName: 'Asha',
        subagentId: 'researcher',
        instruction: 'Send mail.',
        requestedTools: ['artifact_read'],
      })
    ).rejects.toThrow(/not declared/);

    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it('refuses delegation beyond the depth limit', async () => {
    db = createTestDatabase();
    await seedSubagent(['list_tasks']);

    await expect(
      runSubagentTask(db, {
        userId: 1,
        userName: 'Asha',
        subagentId: 'researcher',
        instruction: 'Delegate again.',
        requestedTools: ['list_tasks'],
        depth: 2,
        maxDepth: 1,
      })
    ).rejects.toThrow(/depth limit/);

    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it('keeps an unverified child in verify with parent trace linkage', async () => {
    db = createTestDatabase();
    await seedSubagent(['list_tasks']);
    mocks.runAgentTurn.mockResolvedValue({
      ...verifiedResult,
      status: 'completed',
      verification: {
        verified: false,
        status: 'unverified',
        reason: 'No verification evidence.',
        evidence: {},
      },
    });

    const result = await runSubagentTask(db, {
      userId: 1,
      userName: 'Asha',
      subagentId: 'researcher',
      instruction: 'Check the plan.',
      requestedTools: ['list_tasks'],
      parentTaskId: 'parent-1',
      traceId: 'trace-1',
    });

    const task = await db.getFirstAsync<{
      phase: string;
      input_json: string;
      result_json: string | null;
    }>(
      'SELECT phase, input_json, result_json FROM agent_tasks WHERE id = ?',
      result.agentTaskId
    );
    expect(task?.phase).toBe('verify');
    expect(JSON.parse(task?.input_json ?? '{}').metadata).toMatchObject({
      parentTaskId: 'parent-1',
      traceId: 'trace-1',
    });
    expect(JSON.parse(task?.result_json ?? '{}').metadata).toMatchObject({
      parentTaskId: 'parent-1',
      traceId: 'trace-1',
    });
  });

  it('also records verify phase on a thrown child turn', async () => {
    db = createTestDatabase();
    await seedSubagent(['list_tasks']);
    mocks.runAgentTurn.mockRejectedValue(new Error('child failed'));

    await expect(
      runSubagentTask(db, {
        userId: 1,
        userName: 'Asha',
        subagentId: 'researcher',
        instruction: 'Check the plan.',
        requestedTools: ['list_tasks'],
        parentTaskId: 'parent-1',
      })
    ).rejects.toThrow(/child failed/);

    const task = await db.getFirstAsync<{ status: string; phase: string }>(
      'SELECT status, phase FROM agent_tasks WHERE user_id = 1 ORDER BY created_at DESC LIMIT 1'
    );
    expect(task).toMatchObject({ status: 'failed', phase: 'verify' });
  });
});
