import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { buildMemoryPromptSection } from './prompt';
import { MemoryStore } from './store';

vi.mock('expo-crypto', () => ({ randomUUID: () => `memory-${Math.random().toString(36).slice(2)}` }));

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

describe('memory prompt isolation', () => {
  it('loads durable and session scopes only, and working memory only when passed in', async () => {
    db = createTestDatabase();
    const store = new MemoryStore(db);

    const working = await store.remember({
      userId: 1,
      agentId: 'master',
      scope: 'working',
      key: 'draft_plan',
      value: 'unfinished scratch note',
    });
    await store.remember({
      userId: 1,
      agentId: 'master',
      scope: 'session',
      key: 'current_goal',
      value: 'finish the checklist',
    });
    await store.remember({
      userId: 1,
      agentId: 'master',
      scope: 'long_term',
      key: 'preference',
      value: 'concise answers',
    });
    await store.remember({
      userId: 1,
      agentId: 'master',
      scope: 'task_history',
      key: 'last_outcome',
      value: 'previous task verified',
    });

    const implicit = await buildMemoryPromptSection(db, 1, 'master', null);
    expect(implicit).toContain('Session memory:');
    expect(implicit).toContain('finish the checklist');
    expect(implicit).toContain('concise answers');
    expect(implicit).toContain('previous task verified');
    expect(implicit).not.toContain('draft_plan');
    expect(implicit).not.toContain('unfinished scratch note');

    const explicit = await buildMemoryPromptSection(db, 1, 'master', null, [working]);
    expect(explicit).toContain('Working memory (explicit):');
    expect(explicit).toContain('unfinished scratch note');
  });

  it('keeps other projects out of the project section', async () => {
    db = createTestDatabase();
    const store = new MemoryStore(db);

    await store.remember({
      userId: 1,
      agentId: 'master',
      projectId: 'project-a',
      scope: 'project',
      key: 'stack',
      value: 'visible-value',
    });
    await store.remember({
      userId: 1,
      agentId: 'master',
      projectId: 'project-b',
      scope: 'project',
      key: 'secret-stack',
      value: 'hidden-value',
    });

    const section = await buildMemoryPromptSection(db, 1, 'master', 'project-a');
    expect(section).toContain('visible-value');
    expect(section).not.toContain('hidden-value');
  });
});
