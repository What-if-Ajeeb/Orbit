import type { SQLiteDatabase } from 'expo-sqlite';

import { redactSecrets, truncate } from './redact';
import type {
  PermissionAuditEvent,
  PermissionAuditRecord,
  PermissionCategory,
  PermissionGrantRecord,
  PermissionRequestRecord,
  PermissionRequestStatus,
  PermissionResolution,
  PairedDeviceRecord,
  RiskLevel,
} from './types';

type RequestRow = {
  id: string;
  user_id: number;
  agent_id: string;
  agent_name: string;
  agent_role: PermissionRequestRecord['agentRole'];
  category: PermissionCategory;
  risk: RiskLevel;
  tool_name: string;
  project_id: string;
  project_label: string;
  conversation_id: number | null;
  title: string;
  summary: string;
  actions: string;
  target: string;
  reason: string;
  command_preview: string | null;
  scope_key: string;
  allow_always: number;
  status: PermissionRequestStatus;
  resolution: PermissionResolution | null;
  created_at: number;
  expires_at: number;
  resolved_at: number | null;
  metadata: string;
};

type GrantRow = {
  id: string;
  user_id: number;
  request_id: string | null;
  agent_id: string;
  agent_name: string;
  tool_name: string;
  category: PermissionCategory;
  scope_key: string;
  project_id: string;
  project_label: string;
  scope: PermissionGrantRecord['scope'];
  risk: RiskLevel;
  title: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  use_count: number;
  max_uses: number | null;
  revoked_at: number | null;
  status: PermissionGrantRecord['status'];
};

type AuditRow = {
  id: number;
  user_id: number;
  request_id: string | null;
  grant_id: string | null;
  agent_id: string | null;
  event: PermissionAuditEvent;
  category: PermissionCategory | null;
  risk: RiskLevel | null;
  tool_name: string | null;
  project_id: string | null;
  detail: string;
  created_at: number;
};

type DeviceRow = {
  id: string;
  user_id: number;
  name: string;
  platform: string;
  endpoint: string;
  fingerprint: string;
  status: PairedDeviceRecord['status'];
  capabilities: string;
  paired_at: number;
  last_seen_at: number | null;
};

const REQUEST_COLUMNS = `id, user_id, agent_id, agent_name, agent_role, category, risk,
  tool_name, project_id, project_label, conversation_id, title, summary, actions,
  target, reason, command_preview, scope_key, allow_always, status, resolution,
  created_at, expires_at, resolved_at, metadata`;

const GRANT_COLUMNS = `id, user_id, request_id, agent_id, agent_name, tool_name,
  category, scope_key, project_id, project_label, scope, risk, title, created_at,
  expires_at, last_used_at, use_count, max_uses, revoked_at, status`;

const DEVICE_COLUMNS = `id, user_id, name, platform, endpoint, fingerprint, status,
  capabilities, paired_at, last_seen_at`;

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function requestFromRow(row: RequestRow): PermissionRequestRecord {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentRole: row.agent_role,
    category: row.category,
    risk: row.risk,
    toolName: row.tool_name,
    projectId: row.project_id,
    projectLabel: row.project_label,
    conversationId: row.conversation_id,
    title: row.title,
    summary: row.summary,
    actions: parseJson<string[]>(row.actions, []),
    target: parseJson(row.target, {
      kind: 'resource',
      label: 'Orbit',
    }),
    reason: row.reason,
    commandPreview: row.command_preview,
    scopeKey: row.scope_key,
    allowAlways: row.allow_always === 1,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    metadata: parseJson(row.metadata, {}),
  };
}

function grantFromRow(row: GrantRow): PermissionGrantRecord {
  return {
    id: row.id,
    userId: row.user_id,
    requestId: row.request_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    toolName: row.tool_name,
    category: row.category,
    scopeKey: row.scope_key,
    projectId: row.project_id,
    projectLabel: row.project_label,
    scope: row.scope,
    risk: row.risk,
    title: row.title,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    maxUses: row.max_uses,
    revokedAt: row.revoked_at,
    status: row.status,
  };
}

function auditFromRow(row: AuditRow): PermissionAuditRecord {
  return {
    id: row.id,
    userId: row.user_id,
    requestId: row.request_id,
    grantId: row.grant_id,
    agentId: row.agent_id,
    event: row.event,
    category: row.category,
    risk: row.risk,
    toolName: row.tool_name,
    projectId: row.project_id,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function deviceFromRow(row: DeviceRow): PairedDeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    platform: row.platform,
    endpoint: row.endpoint,
    fingerprint: row.fingerprint,
    status: row.status,
    capabilities: parseJson<string[]>(row.capabilities, []),
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class PermissionStore {
  constructor(private db: SQLiteDatabase) {}

  async insertRequest(request: PermissionRequestRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO permission_requests (
        id, user_id, agent_id, agent_name, agent_role, category, risk, tool_name,
        project_id, project_label, conversation_id, title, summary, actions, target,
        reason, command_preview, scope_key, allow_always, status, resolution,
        created_at, expires_at, resolved_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      request.id,
      request.userId,
      request.agentId,
      request.agentName,
      request.agentRole,
      request.category,
      request.risk,
      request.toolName,
      request.projectId,
      request.projectLabel,
      request.conversationId ?? null,
      request.title,
      request.summary,
      JSON.stringify(request.actions),
      JSON.stringify(request.target),
      request.reason,
      request.commandPreview ?? null,
      request.scopeKey,
      request.allowAlways ? 1 : 0,
      request.status,
      request.resolution ?? null,
      request.createdAt,
      request.expiresAt,
      request.resolvedAt ?? null,
      JSON.stringify(request.metadata)
    );
  }

  async updateRequestStatus(
    id: string,
    status: PermissionRequestStatus,
    resolution: PermissionResolution | null = null,
    resolvedAt: number | null = null
  ): Promise<void> {
    await this.db.runAsync(
      `UPDATE permission_requests
       SET status = ?, resolution = COALESCE(?, resolution), resolved_at = COALESCE(?, resolved_at)
       WHERE id = ?`,
      status,
      resolution,
      resolvedAt,
      id
    );
  }

  async getRequest(id: string): Promise<PermissionRequestRecord | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${REQUEST_COLUMNS} FROM permission_requests WHERE id = ?`,
      id
    )) as RequestRow | null;

    return row ? requestFromRow(row) : null;
  }

  async listRequests(userId: number, limit = 80): Promise<PermissionRequestRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${REQUEST_COLUMNS} FROM permission_requests
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      userId,
      limit
    )) as RequestRow[];

    return rows.map(requestFromRow);
  }

  async expireStaleRequests(now: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE permission_requests
       SET status = 'expired', resolution = 'cancel', resolved_at = ?
       WHERE status IN ('pending', 'auto_approved', 'approved_once', 'approved_always', 'executing')
         AND expires_at < ?`,
      now,
      now
    );
  }

  async expireOrphanedRequests(now: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE permission_requests
       SET status = 'expired', resolution = 'cancel', resolved_at = ?
       WHERE status IN ('pending', 'executing')`,
      now
    );
  }

  async insertGrant(grant: PermissionGrantRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO permission_grants (
        id, user_id, request_id, agent_id, agent_name, tool_name, category,
        scope_key, project_id, project_label, scope, risk, title, created_at,
        expires_at, last_used_at, use_count, max_uses, revoked_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      grant.id,
      grant.userId,
      grant.requestId,
      grant.agentId,
      grant.agentName,
      grant.toolName,
      grant.category,
      grant.scopeKey,
      grant.projectId,
      grant.projectLabel,
      grant.scope,
      grant.risk,
      grant.title,
      grant.createdAt,
      grant.expiresAt,
      grant.lastUsedAt,
      grant.useCount,
      grant.maxUses,
      grant.revokedAt,
      grant.status
    );
  }

  async getGrant(id: string): Promise<PermissionGrantRecord | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${GRANT_COLUMNS} FROM permission_grants WHERE id = ?`,
      id
    )) as GrantRow | null;

    return row ? grantFromRow(row) : null;
  }

  async listGrants(userId: number, limit = 100): Promise<PermissionGrantRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${GRANT_COLUMNS} FROM permission_grants
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      userId,
      limit
    )) as GrantRow[];

    return rows.map(grantFromRow);
  }

  async findMatchingGrant(input: {
    userId: number;
    agentId: string;
    toolName: string;
    category: PermissionCategory;
    projectId: string;
    scopeKey: string;
    now: number;
  }): Promise<PermissionGrantRecord | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${GRANT_COLUMNS} FROM permission_grants
       WHERE user_id = ? AND agent_id = ? AND tool_name = ? AND category = ?
         AND project_id = ? AND scope_key = ? AND scope = 'persistent'
         AND status = 'active' AND revoked_at IS NULL
         AND risk <> 'high'
         AND (expires_at IS NULL OR expires_at > ?)
         AND (max_uses IS NULL OR use_count < max_uses)
       ORDER BY created_at DESC LIMIT 1`,
      input.userId,
      input.agentId,
      input.toolName,
      input.category,
      input.projectId,
      input.scopeKey,
      input.now
    )) as GrantRow | null;

    return row ? grantFromRow(row) : null;
  }

  async markGrantUsed(id: string, now: number, consume: boolean): Promise<void> {
    await this.db.runAsync(
      `UPDATE permission_grants
       SET use_count = use_count + 1,
           last_used_at = ?,
           status = CASE WHEN ? = 1 THEN 'consumed' ELSE status END
       WHERE id = ?`,
      now,
      consume ? 1 : 0,
      id
    );
  }

  async revokeGrant(id: string, userId: number, now: number): Promise<boolean> {
    const result = await this.db.runAsync(
      `UPDATE permission_grants
       SET status = 'revoked', revoked_at = ?
       WHERE id = ? AND user_id = ? AND status = 'active'`,
      now,
      id,
      userId
    );

    return result.changes > 0;
  }

  async revokeAllGrants(userId: number, now: number): Promise<number> {
    const result = await this.db.runAsync(
      `UPDATE permission_grants
       SET status = 'revoked', revoked_at = ?
       WHERE user_id = ? AND status = 'active'`,
      now,
      userId
    );

    return result.changes;
  }

  async revokeAgentGrants(userId: number, agentId: string, now: number): Promise<number> {
    const result = await this.db.runAsync(
      `UPDATE permission_grants
       SET status = 'revoked', revoked_at = ?
       WHERE user_id = ? AND agent_id = ? AND status = 'active'`,
      now,
      userId,
      agentId
    );

    return result.changes;
  }

  async expireGrants(now: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE permission_grants
       SET status = 'expired'
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
      now
    );

    await this.db.runAsync(
      `UPDATE permission_grants
       SET status = 'consumed'
       WHERE status = 'active' AND max_uses IS NOT NULL AND use_count >= max_uses`
    );
  }

  async addAudit(input: {
    userId: number;
    requestId: string | null;
    grantId: string | null;
    agentId: string | null;
    event: PermissionAuditEvent;
    category: PermissionCategory | null;
    risk: RiskLevel | null;
    toolName: string | null;
    projectId: string | null;
    detail: string;
    createdAt?: number;
  }): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO permission_audit (
        user_id, request_id, grant_id, agent_id, event, category, risk,
        tool_name, project_id, detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.userId,
      input.requestId,
      input.grantId,
      input.agentId,
      input.event,
      input.category,
      input.risk,
      input.toolName,
      input.projectId,
      truncate(redactSecrets(input.detail), 600),
      input.createdAt ?? Date.now()
    );
  }

  async listAudit(userId: number, limit = 80): Promise<PermissionAuditRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT id, user_id, request_id, grant_id, agent_id, event, category,
              risk, tool_name, project_id, detail, created_at
       FROM permission_audit WHERE user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      userId,
      limit
    )) as AuditRow[];

    return rows.map(auditFromRow);
  }

  async listDevices(userId: number): Promise<PairedDeviceRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${DEVICE_COLUMNS} FROM paired_devices
       WHERE user_id = ? ORDER BY paired_at DESC`,
      userId
    )) as DeviceRow[];

    return rows.map(deviceFromRow);
  }

  async getDevice(userId: number, id: string): Promise<PairedDeviceRecord | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${DEVICE_COLUMNS} FROM paired_devices WHERE user_id = ? AND id = ?`,
      userId,
      id
    )) as DeviceRow | null;

    return row ? deviceFromRow(row) : null;
  }

  async upsertDevice(device: PairedDeviceRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO paired_devices (
        id, user_id, name, platform, endpoint, fingerprint, status,
        capabilities, paired_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        platform = excluded.platform,
        endpoint = excluded.endpoint,
        fingerprint = excluded.fingerprint,
        status = excluded.status,
        capabilities = excluded.capabilities,
        last_seen_at = excluded.last_seen_at`,
      device.id,
      device.userId,
      device.name,
      device.platform,
      device.endpoint,
      device.fingerprint,
      device.status,
      JSON.stringify(device.capabilities),
      device.pairedAt,
      device.lastSeenAt
    );
  }

  async touchDevice(userId: number, id: string, now: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE paired_devices SET last_seen_at = ?, status = 'paired'
       WHERE user_id = ? AND id = ?`,
      now,
      userId,
      id
    );
  }

  async revokeDevice(userId: number, id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE paired_devices SET status = 'revoked'
       WHERE user_id = ? AND id = ?`,
      userId,
      id
    );
  }

  async getState(key: string): Promise<string | null> {
    const row = (await this.db.getFirstAsync(
      'SELECT value FROM permission_state WHERE key = ?',
      key
    )) as { value: string } | null;

    return row?.value ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO permission_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      Date.now()
    );
  }
}
