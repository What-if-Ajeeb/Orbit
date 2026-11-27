import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Test-only adapter that gives Vitest a real in-memory SQLite engine behind the
 * small subset of the expo-sqlite API used by the agent runtime.
 */
export type TestDatabase = SQLiteDatabase & {
  raw: DatabaseSync;
  close: () => void;
};

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Test user'
  );

  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    agent_id TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta TEXT,
    created_at INTEGER NOT NULL,
    conversation_id INTEGER
  );

  CREATE INDEX idx_messages_user_created ON messages (user_id, created_at);
  CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, id);

  CREATE TABLE workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    instruction TEXT NOT NULL
  );

  CREATE TABLE workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    workflow_id INTEGER NOT NULL,
    conversation_id INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    summary TEXT NOT NULL DEFAULT '',
    traces TEXT NOT NULL DEFAULT '[]',
    agent_task_id TEXT,
    schedule_id TEXT
  );

  CREATE TABLE subagents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    capabilities TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE subagent_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    input TEXT NOT NULL,
    output TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    parent_conversation_id INTEGER,
    agent_id TEXT
  );

  CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0.0',
    capabilities TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_load INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE agent_tasks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    conversation_id INTEGER,
    project_id TEXT NOT NULL DEFAULT 'orbit-workspace',
    parent_task_id TEXT,
    subagent_id TEXT,
    kind TEXT NOT NULL DEFAULT 'turn',
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    phase TEXT NOT NULL DEFAULT 'system',
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    verification_json TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    priority INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    lease_owner TEXT,
    lease_until INTEGER,
    budget_json TEXT NOT NULL DEFAULT '{}',
    grants_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    next_run_at INTEGER
  );

  CREATE TABLE agent_task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    sequence INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    previous_hash TEXT NOT NULL DEFAULT '',
    hash TEXT NOT NULL
  );

  CREATE TABLE agent_task_attempts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error TEXT,
    verification TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE agent_task_schedules (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    task_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    input_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    interval_ms INTEGER,
    next_run_at INTEGER NOT NULL,
    last_run_at INTEGER,
    lease_owner TEXT,
    lease_until INTEGER,
    idempotency_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE agent_memory (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    agent_id TEXT NOT NULL DEFAULT 'master',
    project_key TEXT NOT NULL DEFAULT '',
    project_id TEXT,
    scope TEXT NOT NULL DEFAULT 'agent',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'agent',
    confidence REAL NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (user_id, agent_id, project_key, scope, key)
  );

  CREATE TABLE hermes_memory_writes (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    agent_id TEXT NOT NULL DEFAULT 'master',
    target TEXT NOT NULL,
    action TEXT NOT NULL,
    project_key TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'agent',
    confidence REAL NOT NULL DEFAULT 1,
    requested_at INTEGER NOT NULL,
    resolved_at INTEGER,
    applied_at INTEGER,
    state TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE skill_versions (
    skill_id TEXT NOT NULL,
    version TEXT NOT NULL,
    manifest TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'builtin',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (skill_id, version)
  );

  CREATE TABLE subagent_grants (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    parent_task_id TEXT NOT NULL,
    subagent_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    resource_key TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );

  CREATE TABLE active_operations (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    created_at INTEGER NOT NULL
  );
`;

export function createTestDatabase(): TestDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);

  const db = {
    raw,
    async execAsync(sql: string): Promise<void> {
      raw.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
      const result = raw.prepare(sql).run(...(params as never[]));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    async getFirstAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T | null> {
      return (raw.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
    },
    async getAllAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
      return raw.prepare(sql).all(...(params as never[])) as T[];
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    async closeAsync(): Promise<void> {
      raw.close();
    },
    close(): void {
      raw.close();
    },
  };

  return db as unknown as TestDatabase;
}
