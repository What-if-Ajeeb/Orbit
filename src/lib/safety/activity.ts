import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { SQLiteDatabase } from 'expo-sqlite';

import { redactSecrets, truncate } from '../permissions/redact';
import type { ActivityInput, ActivityRecord } from './types';

type ActivityRow = {
  id: string;
  sequence: number;
  user_id: number;
  conversation_id: number | null;
  agent_id: string;
  agent_name: string;
  tool_name: string;
  action: string;
  resource_key: string;
  resource_label: string;
  permission_used: string;
  status: ActivityRecord['status'];
  result: string;
  error: string;
  category: ActivityRecord['category'];
  risk: ActivityRecord['risk'];
  request_id: string | null;
  grant_id: string | null;
  reversible: number;
  external: number;
  created_at: number;
  metadata: string;
  previous_hash: string;
  hash: string;
};

const ACTIVITY_COLUMNS = `id, sequence, user_id, conversation_id, agent_id, agent_name,
  tool_name, action, resource_key, resource_label, permission_used, status, result, error,
  category, risk, request_id, grant_id, reversible, external, created_at, metadata,
  previous_hash, hash`;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}

function hashChain(value: Record<string, unknown>): string {
  return bytesToHex(sha256(utf8ToBytes(stableJson(value))));
}

function rowToRecord(row: ActivityRow): ActivityRecord {
  let metadata: Record<string, string | number | boolean | null> = {};

  try {
    const parsed = JSON.parse(row.metadata || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, string | number | boolean | null>;
    }
  } catch {
    metadata = {};
  }

  return {
    id: row.id,
    sequence: row.sequence,
    userId: row.user_id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    toolName: row.tool_name,
    action: row.action,
    resourceKey: row.resource_key,
    resourceLabel: row.resource_label,
    permissionUsed: row.permission_used,
    status: row.status,
    result: row.result,
    error: row.error,
    category: row.category,
    risk: row.risk,
    requestId: row.request_id,
    grantId: row.grant_id,
    reversible: row.reversible === 1,
    external: row.external === 1,
    createdAt: row.created_at,
    metadata,
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

/**
 * Append-only activity journal. Each row includes the previous row's hash so
 * a deleted or rewritten entry breaks verification. Details are redacted
 * before they ever reach SQLite.
 */
export class ActivityStore {
  constructor(private db: SQLiteDatabase) {}

  async append(input: ActivityInput): Promise<ActivityRecord> {
    let saved: ActivityRecord | null = null;
    await this.db.withTransactionAsync(async () => {
      const [previous, sequenceRow] = await Promise.all([
        this.db.getFirstAsync(
          `SELECT hash FROM agent_activity WHERE user_id = ? ORDER BY sequence DESC LIMIT 1`,
          input.userId
        ) as Promise<{ hash: string } | null>,
        this.db.getFirstAsync(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_activity`
        ) as Promise<{ sequence: number }>,
      ]);
      const previousHash = previous?.hash ?? '';
      const sequence = sequenceRow?.sequence ?? 1;
      const now = input.createdAt ?? Date.now();
      const metadata = Object.fromEntries(
        Object.entries(input.metadata ?? {}).map(([key, value]) => [
          key,
          typeof value === 'string' ? truncate(redactSecrets(value), 300) : value,
        ])
      );
      const base = {
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        agentId: input.agentId,
        agentName: input.agentName,
        toolName: input.toolName,
        action: input.action,
        resourceKey: input.resourceKey ?? '',
        resourceLabel: input.resourceLabel ?? '',
        permissionUsed: input.permissionUsed ?? '',
        status: input.status,
        result: truncate(redactSecrets(input.result ?? ''), 600),
        error: truncate(redactSecrets(input.error ?? ''), 600),
        category: input.category ?? null,
        risk: input.risk ?? null,
        requestId: input.requestId ?? null,
        grantId: input.grantId ?? null,
        reversible: input.reversible ?? false,
        external: input.external ?? false,
        createdAt: now,
        metadata,
        previousHash,
      };
      const hash = hashChain(base);
      const id = input.id ?? `act_${hash.slice(0, 16)}_${now}`;

      await this.db.runAsync(
        `INSERT INTO agent_activity (
          id, sequence, user_id, conversation_id, agent_id, agent_name, tool_name, action,
          resource_key, resource_label, permission_used, status, result, error,
          category, risk, request_id, grant_id, reversible, external, created_at,
          metadata, previous_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        sequence,
        base.userId,
        base.conversationId,
        base.agentId,
        base.agentName,
        base.toolName,
        base.action,
        base.resourceKey,
        base.resourceLabel,
        base.permissionUsed,
        base.status,
        base.result,
        base.error,
        base.category,
        base.risk,
        base.requestId,
        base.grantId,
        base.reversible ? 1 : 0,
        base.external ? 1 : 0,
        base.createdAt,
        stableJson(base.metadata),
        base.previousHash,
        hash
      );

      const row = (await this.db.getFirstAsync(
        `SELECT ${ACTIVITY_COLUMNS} FROM agent_activity WHERE id = ?`,
        id
      )) as ActivityRow | null;

      if (!row) {
        throw new Error('The activity entry could not be read back.');
      }

      saved = rowToRecord(row);
    });

    if (!saved) {
      throw new Error('The activity entry could not be saved.');
    }

    return saved;
  }

  async list(userId: number, limit = 100): Promise<ActivityRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${ACTIVITY_COLUMNS} FROM agent_activity
       WHERE user_id = ? ORDER BY sequence DESC LIMIT ?`,
      userId,
      limit
    )) as ActivityRow[];

    return rows.map(rowToRecord);
  }

  async listForConversation(
    userId: number,
    conversationId: number,
    limit = 40
  ): Promise<ActivityRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${ACTIVITY_COLUMNS} FROM agent_activity
       WHERE user_id = ? AND conversation_id = ? ORDER BY sequence DESC LIMIT ?`,
      userId,
      conversationId,
      limit
    )) as ActivityRow[];

    return rows.map(rowToRecord);
  }

  /** Verifies every hash link for a user. Returns false on the first break. */
  async verifyChain(userId: number): Promise<boolean> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${ACTIVITY_COLUMNS} FROM agent_activity WHERE user_id = ? ORDER BY sequence ASC`,
      userId
    )) as ActivityRow[];
    let previousHash = '';

    for (const row of rows) {
      const record = rowToRecord(row);

      if (record.previousHash !== previousHash) {
        return false;
      }

      const expected = hashChain({
        userId: record.userId,
        conversationId: record.conversationId,
        agentId: record.agentId,
        agentName: record.agentName,
        toolName: record.toolName,
        action: record.action,
        resourceKey: record.resourceKey,
        resourceLabel: record.resourceLabel,
        permissionUsed: record.permissionUsed,
        status: record.status,
        result: record.result,
        error: record.error,
        category: record.category,
        risk: record.risk,
        requestId: record.requestId,
        grantId: record.grantId,
        reversible: record.reversible,
        external: record.external,
        createdAt: record.createdAt,
        metadata: record.metadata,
        previousHash: record.previousHash,
      });

      if (expected !== record.hash) {
        return false;
      }

      previousHash = record.hash;
    }

    return true;
  }
}
