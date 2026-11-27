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

describe('database migration', () => {
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
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_actions');
    expect(sql).toContain('PRAGMA user_version = 16');
    expect(sql).not.toContain('PRAGMA user_version = 15');
  });

  it('applies the older agent migration on the way to v16', async () => {
    const { db, executed, mocks } = migrationDb(12, ['id', 'user_id', 'title']);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(mocks.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(sql).toContain('ALTER TABLE conversations ADD COLUMN agent_id TEXT');
    expect(sql).toContain("UPDATE conversations SET agent_id = 'master'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_configs');
    expect(sql).toContain('PRAGMA user_version = 16');
  });

  it('adds agent action cards when upgrading from v14', async () => {
    const { db, executed } = migrationDb(14);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_actions');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_agent_actions_user_updated');
    expect(sql).toContain('PRAGMA user_version = 16');
  });

  it('adds durable agent tables and workflow links when upgrading from v15', async () => {
    const { db, executed } = migrationDb(15, ['id', 'user_id', 'workflow_id']);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_tasks');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_task_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_task_attempts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_task_schedules');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_memory');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS skill_versions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS subagent_grants');
    expect(sql).toContain('ALTER TABLE workflow_runs ADD COLUMN agent_task_id TEXT');
    expect(sql).toContain('ALTER TABLE workflow_runs ADD COLUMN schedule_id TEXT');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_workflow_runs_agent_task');
    expect(sql).toContain('PRAGMA user_version = 16');
  });

  it('builds the complete current schema on a fresh install', async () => {
    const { db, executed } = migrationDb(0);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workflows');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_tasks');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_memory');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_workflow_runs_agent_task');
    expect(sql).toContain('PRAGMA user_version = 16');
  });

  it('does nothing when the schema is already current', async () => {
    const { db, executed } = migrationDb(16);

    await migrateDbIfNeeded(db);

    expect(executed).toHaveLength(0);
  });
});
