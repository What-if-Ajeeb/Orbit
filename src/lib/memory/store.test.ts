import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { MemoryStore } from './store';

vi.mock('expo-crypto', () => ({ randomUUID: () => `memory-${Math.random().toString(36).slice(2)}` }));

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

describe('scoped agent memory', () => {
  it('isolates entries by user, agent and project scope', async () => {
    db = createTestDatabase();
    const store = new MemoryStore(db);

    await store.remember({
      userId: 1,
      agentId: 'master',
      scope: 'user',
      key: 'timezone',
      value: 'Asia/Kolkata',
    });
    await store.remember({
      userId: 1,
      agentId: 'researcher',
      scope: 'agent',
      key: 'tone',
      value: 'concise',
    });
    await store.remember({
      userId: 1,
      agentId: 'master',
      projectId: 'project-a',
      scope: 'project',
      key: 'stack',
      value: 'Expo',
    });
    await store.remember({
      userId: 2,
      agentId: 'master',
      scope: 'user',
      key: 'timezone',
      value: 'UTC',
    });

    const visible = await store.recall({ userId: 1, agentId: 'master' });
    expect(visible.map((entry) => entry.value)).toContain('Asia/Kolkata');
    expect(visible.map((entry) => entry.value)).not.toContain('concise');
    expect(visible.map((entry) => entry.value)).not.toContain('UTC');
    expect(visible.map((entry) => entry.value)).not.toContain('Expo');

    const project = await store.recall({
      userId: 1,
      agentId: 'master',
      projectId: 'project-a',
      scope: 'project',
    });
    expect(project.map((entry) => entry.value)).toEqual(['Expo']);
  });

  it('hides expired entries unless explicitly requested', async () => {
    db = createTestDatabase();
    const store = new MemoryStore(db);

    await store.remember({
      userId: 1,
      agentId: 'master',
      scope: 'agent',
      key: 'temporary',
      value: 'short lived',
      ttlMs: 60_000,
    });
    db.raw
      .prepare('UPDATE agent_memory SET expires_at = ? WHERE key = ?')
      .run(Date.now() - 1_000, 'temporary');

    expect(await store.recall({ userId: 1, agentId: 'master' })).toHaveLength(0);
    const expired = await store.recall({
      userId: 1,
      agentId: 'master',
      includeExpired: true,
    });
    expect(expired).toHaveLength(1);
    expect(expired[0]?.key).toBe('temporary');
  });

  it('redacts secrets before storing a value and forgets only the exact scope', async () => {
    db = createTestDatabase();
    const store = new MemoryStore(db);

    const saved = await store.remember({
      userId: 1,
      agentId: 'master',
      scope: 'agent',
      key: 'credential note',
      value: 'token=abcdefghijklmnop',
    });

    expect(saved.key).toBe('credential_note');
    expect(saved.value).toContain('[redacted]');
    expect(saved.value).not.toContain('abcdefghijklmnop');

    const forgotten = await store.forget({
      userId: 1,
      agentId: 'researcher',
      scope: 'agent',
      key: 'credential note',
    });
    expect(forgotten).toBe(false);
    expect(await store.recall({ userId: 1, agentId: 'master' })).toHaveLength(1);
  });

  it('accepts the new taxonomy scopes without changing the default scope', async () => {
    db = createTestDatabase();
    const store = new MemoryStore(db);

    const implicit = await store.remember({
      userId: 1,
      key: 'implicit',
      value: 'agent default',
    });
    expect(implicit.scope).toBe('agent');

    for (const scope of ['working', 'session', 'long_term', 'task_history'] as const) {
      const entry = await store.remember({
        userId: 1,
        agentId: 'master',
        scope,
        key: `key_${scope}`,
        value: `value_${scope}`,
      });
      expect(entry.scope).toBe(scope);
      expect((await store.recall({ userId: 1, agentId: 'master', scope }))[0]?.value).toBe(
        `value_${scope}`
      );
    }

    expect(
      (await store.recall({ userId: 1, agentId: 'master' })).map((e) => e.key)
    ).toEqual(expect.arrayContaining(['implicit', 'key_working', 'key_session', 'key_long_term', 'key_task_history']));
  });
});
