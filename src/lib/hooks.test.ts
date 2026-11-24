import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { HookEngine } from './hooks';

// The real `HookRow` type is internal; this mirror keeps the fake database
// honest without importing expo-sqlite at runtime.
type FakeHookRow = {
  id: string;
  name: string;
  description: string;
  hook_type: string;
  enabled: number;
  code: string;
  priority: number;
};

function fakeDatabase(rows: FakeHookRow[]): SQLiteDatabase {
  return {
    getAllAsync: async () => rows,
  } as unknown as SQLiteDatabase;
}

describe('HookEngine', () => {
  it('never compiles or executes stored hook code', async () => {
    const globalWithFlag = globalThis as Record<string, unknown>;
    delete globalWithFlag.__orbitHookRan;

    const row: FakeHookRow = {
      id: 'legacy-hook',
      name: 'Legacy hook',
      description: 'Untrusted code kept only for compatibility',
      hook_type: 'before_agent_turn',
      enabled: 1,
      code: 'globalThis.__orbitHookRan = true; return { ok: true };',
      priority: 0,
    };
    const engine = new HookEngine(fakeDatabase([row]));

    const executions = await engine.executeHook('before_agent_turn', {
      timestamp: Date.now(),
      userId: 1,
    });

    expect(executions).toHaveLength(1);
    expect(executions[0].success).toBe(false);
    expect(executions[0].error).toMatch(/disabled/i);
    expect(globalWithFlag.__orbitHookRan).toBeUndefined();
  });
});
