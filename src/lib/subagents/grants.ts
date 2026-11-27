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

/** Declared grants may bind a tool to a category and a specific resource. */
export type DeclaredSubagentGrant = {
  toolName?: string;
  /** Accepted for callers that describe capabilities by name instead. */
  name?: string;
  category?: string;
  resourceKey?: string;
};

type DeclaredCapability = string | DeclaredSubagentGrant;

function grantDescriptor(value: DeclaredCapability): { toolName: string; category: string; resourceKey: string } | null {
  const toolName = typeof value === 'string'
    ? value.trim()
    : (value.toolName ?? (value as { name?: string }).name ?? '').trim();
  if (!toolName) return null;
  return {
    toolName,
    category: typeof value === 'string' ? '' : value.category?.trim() ?? '',
    resourceKey: typeof value === 'string' ? '' : value.resourceKey?.trim() ?? '',
  };
}

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
  declaredCapabilities: DeclaredCapability[];
  requestedTools: DeclaredCapability[];
  declaredGrants?: DeclaredSubagentGrant[];
  ttlMs?: number;
}): Promise<CapabilityGrant[]> {
  const declared = new Map<string, { category: string; resourceKey: string }>();
  for (const entry of [...options.declaredCapabilities, ...(options.declaredGrants ?? [])]) {
    const descriptor = grantDescriptor(entry);
    if (descriptor) {
      declared.set(descriptor.toolName, {
        category: descriptor.category,
        resourceKey: descriptor.resourceKey,
      });
    }
  }

  const requested = new Map<string, { category: string; resourceKey: string }>();
  for (const entry of options.requestedTools) {
    const descriptor = grantDescriptor(entry);
    if (descriptor) requested.set(descriptor.toolName, descriptor);
  }

  if (requested.size === 0) {
    throw new Error('A subagent must receive at least one explicit capability grant.');
  }

  const now = Date.now();
  const expiresAt = options.ttlMs && options.ttlMs > 0 ? now + options.ttlMs : null;
  const grants: CapabilityGrant[] = [];

  for (const [toolName, request] of requested) {
    const binding = declared.get(toolName);
    if (!binding) {
      throw new Error(`${toolName} is not declared by subagent ${options.subagentId}.`);
    }
    if (!agentToolRegistry.get(toolName)) {
      throw new Error(`${toolName} is not a registered ORBIT tool.`);
    }

    const category = request.category || binding.category;
    const resourceKey = request.resourceKey || binding.resourceKey;
    const id = `grant_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await options.db.runAsync(
      `INSERT INTO subagent_grants (
        id, user_id, parent_task_id, subagent_id, tool_name, category, resource_key,
        status, expires_at, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
      id,
      options.userId,
      options.parentTaskId,
      options.subagentId,
      toolName,
      category,
      resourceKey,
      expiresAt,
      now
    );
    grants.push(rowToGrant({
      tool_name: toolName,
      category,
      resource_key: resourceKey,
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
