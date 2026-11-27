import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { createSubagentGrants, listSubagentGrants, revokeSubagentGrants } from './grants';

vi.mock('../ai/tool-registry', () => ({
  agentToolRegistry: {
    get: (name: string) =>
      ['list_tasks', 'artifact_read'].includes(name) ? { definition: { name } } : null,
  },
}));

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

describe('subagent capability grants', () => {
  it('creates only explicitly declared and registered grants', async () => {
    db = createTestDatabase();

    const grants = await createSubagentGrants({
      db,
      userId: 1,
      parentTaskId: 'parent-1',
      subagentId: 'researcher',
      declaredCapabilities: ['list_tasks', 'artifact_read'],
      requestedTools: ['list_tasks', 'list_tasks', 'artifact_read'],
    });

    expect(grants.map((grant) => grant.toolName)).toEqual(['list_tasks', 'artifact_read']);
    expect(await listSubagentGrants(db, 1, 'parent-1', 'researcher')).toHaveLength(2);
    expect(grants.every((grant) => !grant.category && !grant.resourceKey)).toBe(true);
  });

  it('binds declared category and resourceKey to stored grants', async () => {
    db = createTestDatabase();

    const grants = await createSubagentGrants({
      db,
      userId: 1,
      parentTaskId: 'parent-2',
      subagentId: 'researcher',
      declaredCapabilities: [
        { toolName: 'artifact_read', category: 'files', resourceKey: 'doc-1' },
        'list_tasks',
      ],
      declaredGrants: [{ toolName: 'list_tasks', category: 'tasks', resourceKey: 'task-9' }],
      requestedTools: ['artifact_read', 'list_tasks'],
    });

    expect(grants.map((grant) => [grant.category, grant.resourceKey])).toEqual([
      ['files', 'doc-1'],
      ['tasks', 'task-9'],
    ]);

    const stored = await db.getAllAsync<{ tool_name: string; category: string; resource_key: string }>(
      'SELECT tool_name, category, resource_key FROM subagent_grants WHERE parent_task_id = ? ORDER BY rowid ASC',
      'parent-2'
    );
    expect(stored).toEqual([
      { tool_name: 'artifact_read', category: 'files', resource_key: 'doc-1' },
      { tool_name: 'list_tasks', category: 'tasks', resource_key: 'task-9' },
    ]);
    expect((await listSubagentGrants(db, 1, 'parent-2', 'researcher'))[0]).toMatchObject({
      category: 'files',
      resourceKey: 'doc-1',
    });
  });

  it('rejects undeclared and unregistered tools', async () => {
    db = createTestDatabase();

    await expect(
      createSubagentGrants({
        db,
        userId: 1,
        parentTaskId: 'parent-1',
        subagentId: 'researcher',
        declaredCapabilities: ['list_tasks'],
        requestedTools: ['google_gmail_send'],
      })
    ).rejects.toThrow(/not declared/);

    await expect(
      createSubagentGrants({
        db,
        userId: 1,
        parentTaskId: 'parent-1',
        subagentId: 'researcher',
        declaredCapabilities: ['google_gmail_send'],
        requestedTools: ['google_gmail_send'],
      })
    ).rejects.toThrow(/registered ORBIT tool/);
  });

  it('revokes grants without deleting the audit row', async () => {
    db = createTestDatabase();
    await createSubagentGrants({
      db,
      userId: 1,
      parentTaskId: 'parent-1',
      subagentId: 'researcher',
      declaredCapabilities: ['list_tasks'],
      requestedTools: ['list_tasks'],
    });

    expect(await revokeSubagentGrants(db, 1, 'parent-1', 'researcher')).toBe(1);
    const grants = await listSubagentGrants(db, 1, 'parent-1', 'researcher');
    expect(grants).toHaveLength(1);
    expect(grants[0]?.status).toBe('revoked');
  });
});
