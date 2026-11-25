import type { SQLiteDatabase } from 'expo-sqlite';

import {
  AGENT_ACTION_STATUSES,
  type AgentActionRecord,
  type AgentActionStatus,
} from './types';

type ActionRow = {
  id: string;
  user_id: number;
  conversation_id: number | null;
  agent_id: string;
  agent_name: string;
  kind: string;
  tool_name: string;
  status: string;
  title: string;
  target: string;
  payload: string;
  tool_args: string;
  fingerprint: string;
  permission_request_id: string | null;
  risk: string;
  category: string;
  approval_fingerprint: string | null;
  approved_at: number | null;
  result: string | null;
  error: string | null;
  trace: string | null;
  created_at: number;
  updated_at: number;
};

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseLines(target: string): string[] {
  return target
    ? target.split('\n').filter((line) => line.length > 0)
    : [];
}

function toRecord(row: ActionRow): AgentActionRecord {
  const display = parseObject(row.payload).__display;

  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    kind: row.kind,
    toolName: row.tool_name,
    status: AGENT_ACTION_STATUSES.includes(row.status as AgentActionStatus)
      ? (row.status as AgentActionStatus)
      : 'draft',
    title: row.title,
    target: row.target,
    lines: Array.isArray(display)
      ? display.filter((line): line is string => typeof line === 'string')
      : parseLines(row.payload),
    payload: parseObject(row.payload),
    toolArgs: parseObject(row.tool_args),
    fingerprint: row.fingerprint,
    permissionRequestId: row.permission_request_id,
    risk: row.risk as AgentActionRecord['risk'],
    category: row.category as AgentActionRecord['category'],
    approvalFingerprint: row.approval_fingerprint,
    approvedAt: row.approved_at,
    result: row.result,
    error: row.error,
    trace: row.trace,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAgentAction(
  db: SQLiteDatabase,
  id: string
): Promise<AgentActionRecord | null> {
  const row = await db.getFirstAsync<ActionRow>(
    'SELECT * FROM agent_actions WHERE id = ?',
    id
  );

  return row ? toRecord(row) : null;
}

export async function listAgentActions(
  db: SQLiteDatabase,
  userId: number,
  limit = 100
): Promise<AgentActionRecord[]> {
  const rows = await db.getAllAsync<ActionRow>(
    'SELECT * FROM agent_actions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
    userId,
    Math.min(Math.max(limit, 1), 300)
  );

  return rows.map(toRecord);
}

export async function insertAgentAction(
  db: SQLiteDatabase,
  record: AgentActionRecord
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO agent_actions (
      id, user_id, conversation_id, agent_id, agent_name, kind, tool_name, status,
      title, target, payload, tool_args, fingerprint, permission_request_id,
      risk, category, approval_fingerprint, approved_at, result, error, trace,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.userId,
    record.conversationId,
    record.agentId,
    record.agentName,
    record.kind,
    record.toolName,
    record.status,
    record.title,
    record.target,
    JSON.stringify({ ...record.payload, __display: record.lines }),
    JSON.stringify(record.toolArgs),
    record.fingerprint,
    record.permissionRequestId,
    record.risk,
    record.category,
    record.approvalFingerprint,
    record.approvedAt,
    record.result,
    record.error,
    record.trace,
    record.createdAt,
    record.updatedAt
  );
}

export async function updateAgentAction(
  db: SQLiteDatabase,
  record: AgentActionRecord
): Promise<void> {
  await db.runAsync(
    `UPDATE agent_actions SET
      status = ?, tool_name = ?, title = ?, target = ?, payload = ?, tool_args = ?,
      fingerprint = ?, permission_request_id = ?, risk = ?, category = ?,
      approval_fingerprint = ?, approved_at = ?, result = ?, error = ?, trace = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`,
    record.status,
    record.toolName,
    record.title,
    record.target,
    JSON.stringify({ ...record.payload, __display: record.lines }),
    JSON.stringify(record.toolArgs),
    record.fingerprint,
    record.permissionRequestId,
    record.risk,
    record.category,
    record.approvalFingerprint,
    record.approvedAt,
    record.result,
    record.error,
    record.trace,
    record.updatedAt,
    record.id,
    record.userId
  );
}
