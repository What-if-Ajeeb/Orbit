import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { redactSecrets, truncate } from '../permissions/redact';

export type MemoryScope = 'user' | 'agent' | 'project';

export type MemoryEntry = {
  id: string;
  userId: number;
  agentId: string;
  projectId: string | null;
  scope: MemoryScope;
  key: string;
  value: string;
  source: string;
  confidence: number;
  version: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type MemoryRow = {
  id: string;
  user_id: number;
  agent_id: string;
  project_key: string;
  project_id: string | null;
  scope: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  version: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = `id, user_id, agent_id, project_key, project_id, scope, key, value,
  source, confidence, version, expires_at, created_at, updated_at`;

const KEY_MAX = 120;
const VALUE_MAX = 4_000;
const VALID_SCOPES: MemoryScope[] = ['user', 'agent', 'project'];

function normalizeKey(key: string): string {
  return key.trim().replace(/\s+/g, '_').slice(0, KEY_MAX);
}

function projectKey(projectId?: string | null): string {
  return projectId?.trim() ?? '';
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    projectId: row.project_id,
    scope: row.scope as MemoryScope,
    key: row.key,
    value: row.value,
    source: row.source,
    confidence: row.confidence,
    version: row.version,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MemoryStore {
  constructor(private db: SQLiteDatabase) {}

  async remember(input: {
    userId: number;
    agentId?: string;
    projectId?: string | null;
    scope?: MemoryScope;
    key: string;
    value: string;
    source?: string;
    confidence?: number;
    ttlMs?: number | null;
  }): Promise<MemoryEntry> {
    const key = normalizeKey(input.key);
    if (!key) throw new Error('A memory key is required.');

    const scope = input.scope ?? (input.projectId ? 'project' : 'agent');
    if (!VALID_SCOPES.includes(scope)) throw new Error(`Unsupported memory scope: ${scope}`);

    const value = truncate(redactSecrets(input.value.trim()), VALUE_MAX);
    if (!value) throw new Error('A memory value is required.');

    const now = Date.now();
    const agentId = input.agentId ?? 'master';
    const keyProject = projectKey(scope === 'project' ? input.projectId : null);
    const expiresAt = input.ttlMs && input.ttlMs > 0 ? now + input.ttlMs : null;
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 1));

    await this.db.runAsync(
      `INSERT INTO agent_memory (
        id, user_id, agent_id, project_key, project_id, scope, key, value, source,
        confidence, version, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(user_id, agent_id, project_key, scope, key) DO UPDATE SET
        project_id = excluded.project_id,
        value = excluded.value,
        source = excluded.source,
        confidence = excluded.confidence,
        version = agent_memory.version + 1,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`,
      Crypto.randomUUID(),
      input.userId,
      agentId,
      keyProject,
      scope === 'project' ? input.projectId?.trim() ?? null : null,
      scope,
      key,
      value,
      truncate(input.source ?? 'agent', 80),
      confidence,
      expiresAt,
      now,
      now
    );

    const row = (await this.db.getFirstAsync(
      `SELECT ${COLUMNS} FROM agent_memory
       WHERE user_id = ? AND agent_id = ? AND project_key = ? AND scope = ? AND key = ?`,
      input.userId,
      agentId,
      keyProject,
      scope,
      key
    )) as MemoryRow | null;

    if (!row) throw new Error('The memory entry could not be read back.');
    return rowToEntry(row);
  }

  async recall(input: {
    userId: number;
    agentId?: string;
    projectId?: string | null;
    scope?: MemoryScope;
    key?: string;
    limit?: number;
    includeExpired?: boolean;
  }): Promise<MemoryEntry[]> {
    const now = Date.now();
    const conditions: string[] = ['user_id = ?'];
    const values: (string | number)[] = [input.userId];

    if (input.agentId) {
      conditions.push(`(agent_id = ? OR scope = 'user')`);
      values.push(input.agentId);
    }
    if (input.scope) {
      conditions.push('scope = ?');
      values.push(input.scope);
    }
    if (input.key) {
      conditions.push('key = ?');
      values.push(normalizeKey(input.key));
    }
    if (!input.includeExpired) {
      conditions.push('(expires_at IS NULL OR expires_at > ?)');
      values.push(now);
    }
    if (input.scope === 'project') {
      conditions.push('project_key = ?');
      values.push(projectKey(input.projectId));
    } else {
      conditions.push(`(scope != 'project' OR project_key = ?)`);
      values.push(projectKey(null));
    }

    const rows = (await this.db.getAllAsync(
      `SELECT ${COLUMNS} FROM agent_memory
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE scope WHEN 'user' THEN 0 WHEN 'agent' THEN 1 ELSE 2 END,
                confidence DESC, updated_at DESC
       LIMIT ?`,
      ...values,
      Math.max(1, Math.min(100, input.limit ?? 20))
    )) as MemoryRow[];

    return rows.map(rowToEntry);
  }

  async forget(input: {
    userId: number;
    agentId?: string;
    projectId?: string | null;
    scope?: MemoryScope;
    key: string;
  }): Promise<boolean> {
    const conditions = ['user_id = ?', 'scope = ?', 'key = ?'];
    const values: (string | number)[] = [
      input.userId,
      input.scope ?? 'agent',
      normalizeKey(input.key),
    ];

    if (input.agentId) {
      conditions.push('agent_id = ?');
      values.push(input.agentId);
    }
    if (input.scope === 'project') {
      conditions.push('project_key = ?');
      values.push(projectKey(input.projectId));
    }

    const result = await this.db.runAsync(
      `DELETE FROM agent_memory WHERE ${conditions.join(' AND ')}`,
      ...values
    );
    return result.changes > 0;
  }

  /** Imports the legacy free-text agent memory once, without deleting it. */
  async importLegacyMemory(userId: number, agentId: string, text: string): Promise<boolean> {
    const cleaned = truncate(redactSecrets(text.trim()), VALUE_MAX);
    if (!cleaned) return false;

    const existing = await this.recall({
      userId,
      agentId,
      scope: 'agent',
      key: 'legacy_agent_memory',
      limit: 1,
      includeExpired: true,
    });
    if (existing.length > 0) return false;

    await this.remember({
      userId,
      agentId,
      scope: 'agent',
      key: 'legacy_agent_memory',
      value: cleaned,
      source: 'legacy-import',
      confidence: 0.8,
    });
    return true;
  }
}
