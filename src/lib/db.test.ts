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

describe('database migration v14', () => {
  it('adds scoped safety tables without touching a newer schema', async () => {
    const { db, executed, mocks } = migrationDb(13, ['id', 'user_id', 'title']);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(mocks.withTransactionAsync).not.toHaveBeenCalled();
    expect(sql).toContain('ALTER TABLE permission_requests ADD COLUMN resource_key');
    expect(sql).toContain('ALTER TABLE permission_grants ADD COLUMN choice');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS permission_denials');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS permission_preferences');
    expect(sql).toContain(
      'PRIMARY KEY (user_id, agent_id, tool_name, category, project_id, scope_key, resource_key)'
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_activity');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trash_items');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS active_operations');
    expect(sql).toContain('PRAGMA user_version = 14');
    expect(sql).not.toContain('PRAGMA user_version = 13');
  });

  it('applies the older agent migration on the way to v14', async () => {
    const { db, executed, mocks } = migrationDb(12, ['id', 'user_id', 'title']);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(mocks.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(sql).toContain('ALTER TABLE conversations ADD COLUMN agent_id TEXT');
    expect(sql).toContain("UPDATE conversations SET agent_id = 'master'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_configs');
    expect(sql).toContain('PRAGMA user_version = 14');
  });

  it('does nothing when the schema is already current', async () => {
    const { db, executed } = migrationDb(14);

    await migrateDbIfNeeded(db);

    expect(executed).toHaveLength(0);
  });
});
