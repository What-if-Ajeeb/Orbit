import type { SQLiteDatabase } from 'expo-sqlite';

import type { CapabilityGrant } from '../agent-runtime/types';
import { agentToolRegistry } from '../ai/tool-registry';

type GrantRow = {
  tool_name: string;
  category: string;
  resource_key: string;
  status: string;
  expires_at: number | null;
};

function rowToGrant(row: GrantRow): CapabilityGrant {
  return {
    toolName: row.tool_name,
    ...(row.category ? { category: row.category } : {}),
    ...(row.resource_key ? { resourceKey: row.resource_key } : {}),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
  };
}

/**
 * Delegation grants are explicit, narrow, and stored against the child task.
 * A subagent never inherits the parent agent's tool access or permissions.
 */
export async function createSubagentGrants(options: {
  db: SQLiteDatabase;
  userId: number;
  parentTaskId: string;
  subagentId: string;
  declaredCapabilities: string[];
  requestedTools: string[];
  ttlMs?: number;
}): Promise<CapabilityGrant[]> {
  const declared = new Set(options.declaredCapabilities.map((name) => name.trim()));
  const requested = Array.from(new Set(options.requestedTools.map((name) => name.trim()))).filter(
    Boolean
  );

  if (requested.length === 0) {
    throw new Error('A subagent must receive at least one explicit capability grant.');
  }

  const now = Date.now();
  const expiresAt = options.ttlMs && options.ttlMs > 0 ? now + options.ttlMs : null;
  const grants: CapabilityGrant[] = [];

  for (const toolName of requested) {
    if (!declared.has(toolName)) {
      throw new Error(`${toolName} is not declared by subagent ${options.subagentId}.`);
    }
    if (!agentToolRegistry.get(toolName)) {
      throw new Error(`${toolName} is not a registered ORBIT tool.`);
    }

    const id = `grant_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await options.db.runAsync(
      `INSERT INTO subagent_grants (
        id, user_id, parent_task_id, subagent_id, tool_name, category, resource_key,
        status, expires_at, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, '', '', 'active', ?, ?, NULL)`,
      id,
      options.userId,
      options.parentTaskId,
      options.subagentId,
      toolName,
      expiresAt,
      now
    );
    grants.push(rowToGrant({
      tool_name: toolName,
      category: '',
      resource_key: '',
      status: 'active',
      expires_at: expiresAt,
    }));
  }

  return grants;
}

export async function listSubagentGrants(
  db: SQLiteDatabase,
  userId: number,
  parentTaskId: string,
  subagentId: string
): Promise<CapabilityGrant[]> {
  const rows = (await db.getAllAsync(
    `SELECT tool_name, category, resource_key, status, expires_at
     FROM subagent_grants
     WHERE user_id = ? AND parent_task_id = ? AND subagent_id = ?`,
    userId,
    parentTaskId,
    subagentId
  )) as GrantRow[];
  return rows.map(rowToGrant);
}

export async function revokeSubagentGrants(
  db: SQLiteDatabase,
  userId: number,
  parentTaskId: string,
  subagentId: string
): Promise<number> {
  const result = await db.runAsync(
    `UPDATE subagent_grants SET status = 'revoked', revoked_at = ?
     WHERE user_id = ? AND parent_task_id = ? AND subagent_id = ? AND status = 'active'`,
    Date.now(),
    userId,
    parentTaskId,
    subagentId
  );
  return result.changes;
}
