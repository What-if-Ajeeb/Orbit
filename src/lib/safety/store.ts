import type { SQLiteDatabase } from 'expo-sqlite';

import type { ActiveOperation, TrashItem } from './types';

type TrashRow = {
  id: string;
  user_id: number;
  conversation_id: number | null;
  agent_id: string;
  tool_name: string;
  original_path: string;
  stored_path: string;
  kind: TrashItem['kind'];
  name: string;
  size: number;
  mime_type: string;
  metadata: string;
  deleted_at: number;
  expires_at: number;
  restored_at: number | null;
  purged_at: number | null;
  status: TrashItem['status'];
  failure_reason: string | null;
};

type OperationRow = {
  id: string;
  user_id: number;
  conversation_id: number | null;
  agent_id: string;
  agent_name: string;
  tool_name: string;
  status: ActiveOperation['status'];
  cancellable: number;
  external: number;
  started_at: number;
  finished_at: number | null;
  detail: string;
};

const TRASH_COLUMNS = `id, user_id, conversation_id, agent_id, tool_name, original_path,
  stored_path, kind, name, size, mime_type, metadata, deleted_at, expires_at, restored_at,
  purged_at, status, failure_reason`;

const OPERATION_COLUMNS = `id, user_id, conversation_id, agent_id, agent_name, tool_name,
  status, cancellable, external, started_at, finished_at, detail`;

function parseJson(value: string | null): Record<string, string | number | boolean | null> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string | number | boolean | null>)
      : {};
  } catch {
    return {};
  }
}

function trashFromRow(row: TrashRow): TrashItem {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    toolName: row.tool_name,
    originalPath: row.original_path,
    storedPath: row.stored_path,
    kind: row.kind,
    name: row.name,
    size: row.size,
    mimeType: row.mime_type,
    metadata: parseJson(row.metadata),
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at,
    restoredAt: row.restored_at,
    purgedAt: row.purged_at,
    status: row.status,
    failureReason: row.failure_reason,
  };
}

function operationFromRow(row: OperationRow): ActiveOperation {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    toolName: row.tool_name,
    status: row.status,
    cancellable: row.cancellable === 1,
    external: row.external === 1,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    detail: row.detail,
  };
}

export class SafetyStore {
  constructor(private db: SQLiteDatabase) {}

  async insertTrash(item: TrashItem): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO trash_items (
        id, user_id, conversation_id, agent_id, tool_name, original_path, stored_path,
        kind, name, size, mime_type, metadata, deleted_at, expires_at, restored_at,
        purged_at, status, failure_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      item.userId,
      item.conversationId,
      item.agentId,
      item.toolName,
      item.originalPath,
      item.storedPath,
      item.kind,
      item.name,
      item.size,
      item.mimeType,
      JSON.stringify(item.metadata),
      item.deletedAt,
      item.expiresAt,
      item.restoredAt,
      item.purgedAt,
      item.status,
      item.failureReason
    );
  }

  async getTrash(userId: number, id: string): Promise<TrashItem | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${TRASH_COLUMNS} FROM trash_items WHERE id = ? AND user_id = ?`,
      id,
      userId
    )) as TrashRow | null;

    return row ? trashFromRow(row) : null;
  }

  async listTrash(userId: number, limit = 100): Promise<TrashItem[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${TRASH_COLUMNS} FROM trash_items
       WHERE user_id = ? ORDER BY deleted_at DESC LIMIT ?`,
      userId,
      limit
    )) as TrashRow[];

    return rows.map(trashFromRow);
  }

  async latestTrash(userId: number, conversationId?: number | null): Promise<TrashItem | null> {
    const row = conversationId
      ? ((await this.db.getFirstAsync(
          `SELECT ${TRASH_COLUMNS} FROM trash_items
           WHERE user_id = ? AND conversation_id = ? AND status = 'trashed'
           ORDER BY deleted_at DESC LIMIT 1`,
          userId,
          conversationId
        )) as TrashRow | null)
      : ((await this.db.getFirstAsync(
          `SELECT ${TRASH_COLUMNS} FROM trash_items
           WHERE user_id = ? AND status = 'trashed'
           ORDER BY deleted_at DESC LIMIT 1`,
          userId
        )) as TrashRow | null);

    return row ? trashFromRow(row) : null;
  }

  async updateTrashStatus(
    userId: number,
    id: string,
    status: TrashItem['status'],
    timestamp: number,
    failureReason: string | null = null
  ): Promise<void> {
    if (status === 'restored') {
      await this.db.runAsync(
        `UPDATE trash_items
         SET status = ?, failure_reason = ?, restored_at = ?
         WHERE id = ? AND user_id = ?`,
        status,
        failureReason,
        timestamp,
        id,
        userId
      );
      return;
    }

    if (status === 'purged') {
      await this.db.runAsync(
        `UPDATE trash_items
         SET status = ?, failure_reason = ?, purged_at = ?
         WHERE id = ? AND user_id = ?`,
        status,
        failureReason,
        timestamp,
        id,
        userId
      );
      return;
    }

    await this.db.runAsync(
      `UPDATE trash_items SET status = ?, failure_reason = ?
       WHERE id = ? AND user_id = ?`,
      status,
      failureReason,
      id,
      userId
    );
  }

  async listExpiredTrash(now: number): Promise<TrashItem[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${TRASH_COLUMNS} FROM trash_items
       WHERE status = 'trashed' AND expires_at <= ?`,
      now
    )) as TrashRow[];

    return rows.map(trashFromRow);
  }

  async insertOperation(operation: ActiveOperation): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO active_operations (
        id, user_id, conversation_id, agent_id, agent_name, tool_name, status,
        cancellable, external, started_at, finished_at, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        finished_at = excluded.finished_at,
        detail = excluded.detail`,
      operation.id,
      operation.userId,
      operation.conversationId,
      operation.agentId,
      operation.agentName,
      operation.toolName,
      operation.status,
      operation.cancellable ? 1 : 0,
      operation.external ? 1 : 0,
      operation.startedAt,
      operation.finishedAt,
      operation.detail
    );
  }

  async updateOperationStatus(
    userId: number,
    id: string,
    status: ActiveOperation['status'],
    detail: string,
    finishedAt: number | null = null
  ): Promise<void> {
    await this.db.runAsync(
      `UPDATE active_operations
       SET status = ?, detail = ?, finished_at = COALESCE(?, finished_at)
       WHERE id = ? AND user_id = ?`,
      status,
      detail,
      finishedAt,
      id,
      userId
    );
  }

  async listOperations(userId: number, limit = 50): Promise<ActiveOperation[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${OPERATION_COLUMNS} FROM active_operations
       WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`,
      userId,
      limit
    )) as OperationRow[];

    return rows.map(operationFromRow);
  }
}
