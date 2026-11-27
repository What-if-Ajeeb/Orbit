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
});
