import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { migrateDbIfNeeded } from './db';

function migrationDb(version: number, columns: string[] = []) {
  const executed: string[] = [];

  const db = {
    getFirstAsync: vi.fn(async () => ({ user_version: version })),
    getAllAsync: vi.fn(async () => columns.map((name) => ({ name }))),
    execAsync: vi.fn(async (sql: string) => {
      executed.push(sql);
    }),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => {
      await task();
    }),
  };

  return { db: db as unknown as SQLiteDatabase, executed, mocks: db };
}

describe('database migration v13', () => {
  it('adds the agent_id column and agent_configs table without touching newer schemas', async () => {
    const { db, executed, mocks } = migrationDb(12, ['id', 'user_id', 'title']);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(mocks.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(sql).toContain('ALTER TABLE conversations ADD COLUMN agent_id TEXT');
    expect(sql).toContain("UPDATE conversations SET agent_id = 'master'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_configs');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_conversations_user_agent');
    expect(sql).toContain('PRAGMA user_version = 13');
  });

  it('skips the ALTER TABLE when agent_id already exists', async () => {
    const { db, executed } = migrationDb(12, ['id', 'agent_id']);

    await migrateDbIfNeeded(db);

    expect(executed.join('\n')).not.toContain('ALTER TABLE conversations ADD COLUMN agent_id');
    expect(executed.join('\n')).toContain('CREATE TABLE IF NOT EXISTS agent_configs');
  });

  it('does nothing when the schema is already current', async () => {
    const { db, executed } = migrationDb(13);

    await migrateDbIfNeeded(db);

    expect(executed).toHaveLength(0);
  });
});
