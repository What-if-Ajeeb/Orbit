import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { AuthError, listLocalAccounts, switchAccount } from './auth';

vi.mock('expo-crypto', () => ({
  getRandomBytes: () => new Uint8Array(32),
}));

const userRow = {
  id: 2,
  name: 'Ajeeb',
  email: 'ajeeb@example.com',
  created_at: 100,
};

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    getAllAsync: vi.fn(async () => [userRow]),
    getFirstAsync: vi.fn(async () => userRow),
    runAsync: vi.fn(async (_sql: string, _params?: unknown[]) => ({
      lastInsertRowId: 1,
      changes: 1,
    })),
    ...overrides,
  };
}

function asDb(db: ReturnType<typeof makeDb>): SQLiteDatabase {
  return db as unknown as SQLiteDatabase;
}

describe('local accounts', () => {
  it('lists accounts stored on the device', async () => {
    const db = makeDb();

    await expect(listLocalAccounts(asDb(db))).resolves.toEqual([
      { id: 2, name: 'Ajeeb', email: 'ajeeb@example.com', createdAt: 100 },
    ]);
  });

  it('creates a session when switching accounts', async () => {
    const db = makeDb();

    const result = await switchAccount(asDb(db), 2);

    expect(result.user.id).toBe(2);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(db.runAsync.mock.calls[0][0]).toContain('DELETE FROM sessions');
    expect(db.runAsync.mock.calls[1][0]).toContain('INSERT INTO sessions');
  });

  it('rejects switching to an unknown account', async () => {
    const db = makeDb({ getFirstAsync: vi.fn(async () => null) });

    await expect(switchAccount(asDb(db), 99)).rejects.toBeInstanceOf(AuthError);
    expect(db.runAsync).not.toHaveBeenCalled();
  });
});
