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
    expect(sql).toContain('PRAGMA user_version = 18');
    expect(sql).not.toContain('PRAGMA user_version = 15');
  });

  it('applies the older agent migration on the way to v17', async () => {
    const { db, executed, mocks } = migrationDb(12, ['id', 'user_id', 'title']);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(mocks.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(sql).toContain('ALTER TABLE conversations ADD COLUMN agent_id TEXT');
    expect(sql).toContain("UPDATE conversations SET agent_id = 'master'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_configs');
    expect(sql).toContain('PRAGMA user_version = 18');
  });

  it('adds agent action cards when upgrading from v14', async () => {
    const { db, executed } = migrationDb(14);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_actions');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_agent_actions_user_updated');
    expect(sql).toContain('PRAGMA user_version = 18');
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
    expect(sql).toContain('PRAGMA user_version = 18');
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
    expect(sql).toContain('PRAGMA user_version = 18');
  });

  it('adds hybrid agent columns and ledgers when upgrading from v16', async () => {
    const { db, executed } = migrationDb(16, ['id', 'status']);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(sql).toContain('ALTER TABLE agent_tasks ADD COLUMN hybrid_state TEXT');
    expect(sql).toContain('ALTER TABLE agent_tasks ADD COLUMN trace_id TEXT');
    expect(sql).toContain("ALTER TABLE agent_tasks ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}'");
    expect(sql).toContain("ALTER TABLE agent_tasks ADD COLUMN risk_json TEXT NOT NULL DEFAULT '{}'");
    expect(sql).toContain("WHEN 'awaiting_tool' THEN 'WAITING_FOR_APPROVAL'");
    expect(sql).toContain("WHEN 'needs_review' THEN 'BLOCKED'");
    expect(sql).toContain("WHEN 'completed' THEN 'COMPLETED'");
    expect(sql).toContain('ALTER TABLE agent_task_events ADD COLUMN trace_id TEXT');
    expect(sql).toContain('ALTER TABLE agent_task_events ADD COLUMN hybrid_state TEXT');
    expect(sql).toContain('ALTER TABLE agent_task_attempts ADD COLUMN trace_id TEXT');
    expect(sql).toContain('ALTER TABLE agent_task_attempts ADD COLUMN step_id TEXT');
    expect(sql).toContain('ALTER TABLE agent_task_schedules ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain("ALTER TABLE agent_task_schedules ADD COLUMN backoff_json TEXT NOT NULL DEFAULT '{}'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_task_approvals');
    expect(sql).toContain('FOREIGN KEY (task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_agent_task_approvals_user_state');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS hybrid_audit_events');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_hybrid_audit_trace_created');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS skill_evaluations');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_skill_evaluations_skill_version');
    expect(sql).toContain('PRAGMA user_version = 18');
  });

  it('skips additive ALTERs when the v17 columns are already present', async () => {
    const { db, executed } = migrationDb(16, [
      'hybrid_state',
      'trace_id',
      'plan_json',
      'risk_json',
      'step_id',
      'attempt',
      'backoff_json',
    ]);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(sql).not.toContain('ALTER TABLE agent_tasks ADD COLUMN');
    expect(sql).not.toContain('ALTER TABLE agent_task_events ADD COLUMN');
    expect(sql).not.toContain('ALTER TABLE agent_task_attempts ADD COLUMN');
    expect(sql).not.toContain('ALTER TABLE agent_task_schedules ADD COLUMN');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_task_approvals');
  });

  it('adds the Hermes staged memory-write ledger when upgrading from v17', async () => {
    const { db, executed } = migrationDb(17);

    await migrateDbIfNeeded(db);

    const sql = executed.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS hermes_memory_writes');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_hermes_memory_writes_user_state');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_hermes_memory_writes_fingerprint');
    expect(sql).toContain('PRAGMA user_version = 18');
  });

  it('does nothing when the schema is already current', async () => {
    const { db, executed } = migrationDb(18);

    await migrateDbIfNeeded(db);

    expect(executed).toHaveLength(0);
  });
});
