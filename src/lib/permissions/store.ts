import type { SQLiteDatabase } from 'expo-sqlite';

import { redactSecrets, truncate } from './redact';
import type {
  PermissionAuditEvent,
  PermissionAuditRecord,
  PermissionCategory,
  PermissionDenialRecord,
  PermissionGrantRecord,
  PermissionPreferenceRecord,
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
  resource_key: string;
  fingerprint: string;
  fresh_confirmation: number;
  reversible: number;
  external: number;
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
  resource_key: string;
  fingerprint: string;
  project_id: string;
  project_label: string;
  scope: PermissionGrantRecord['scope'];
  session_id: string;
  choice: PermissionGrantRecord['choice'];
  narrow: number;
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

type DenialRow = {
  id: string;
  user_id: number;
  agent_id: string;
  tool_name: string;
  category: PermissionCategory;
  project_id: string;
  scope_key: string;
  resource_key: string;
  reason: PermissionDenialRecord['reason'];
  created_at: number;
  revoked_at: number | null;
};

type PreferenceRow = {
  user_id: number;
  agent_id: string;
  tool_name: string;
  category: PermissionCategory;
  project_id: string;
  scope_key: string;
  resource_key: string;
  choice: PermissionPreferenceRecord['choice'];
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
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
  target, reason, command_preview, scope_key, resource_key, fingerprint,
  fresh_confirmation, reversible, external, allow_always, status, resolution,
  created_at, expires_at, resolved_at, metadata`;

const GRANT_COLUMNS = `id, user_id, request_id, agent_id, agent_name, tool_name,
  category, scope_key, resource_key, fingerprint, project_id, project_label,
  scope, session_id, choice, narrow, risk, title, created_at, expires_at,
  last_used_at, use_count, max_uses, revoked_at, status`;

const DENIAL_COLUMNS = `id, user_id, agent_id, tool_name, category, project_id,
  scope_key, resource_key, reason, created_at, revoked_at`;

const PREFERENCE_COLUMNS = `user_id, agent_id, tool_name, category, project_id,
  scope_key, resource_key, choice, created_at, updated_at, revoked_at`;

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
    resourceKey: row.resource_key || row.scope_key,
    fingerprint: row.fingerprint,
    freshConfirmation: row.fresh_confirmation === 1,
    reversible: row.reversible !== 0,
    external: row.external === 1,
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
    resourceKey: row.resource_key || row.scope_key,
    fingerprint: row.fingerprint,
    projectId: row.project_id,
    projectLabel: row.project_label,
    scope: row.scope,
    sessionId: row.session_id,
    choice:
      row.choice === 'allow_session' || row.choice === 'one_time'
        ? row.choice
        : 'always_allow',
    narrow: row.narrow !== 0,
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

function denialFromRow(row: DenialRow): PermissionDenialRecord {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    toolName: row.tool_name,
    category: row.category,
    projectId: row.project_id,
    scopeKey: row.scope_key,
    resourceKey: row.resource_key || row.scope_key,
    reason: row.reason,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

function preferenceFromRow(row: PreferenceRow): PermissionPreferenceRecord {
  return {
    userId: row.user_id,
    agentId: row.agent_id,
    toolName: row.tool_name,
    category: row.category,
    projectId: row.project_id,
    scopeKey: row.scope_key,
    resourceKey: row.resource_key || row.scope_key,
    choice: 'ask_every_time',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
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
        reason, command_preview, scope_key, resource_key, fingerprint,
        fresh_confirmation, reversible, external, allow_always, status, resolution,
        created_at, expires_at, resolved_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      request.resourceKey,
      request.fingerprint,
      request.freshConfirmation ? 1 : 0,
      request.reversible ? 1 : 0,
      request.external ? 1 : 0,
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
       WHERE status IN ('pending', 'auto_approved', 'approved_once', 'approved_session', 'approved_always')
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
        scope_key, resource_key, fingerprint, project_id, project_label, scope,
        session_id, choice, narrow, risk, title, created_at, expires_at,
        last_used_at, use_count, max_uses, revoked_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      grant.id,
      grant.userId,
      grant.requestId,
      grant.agentId,
      grant.agentName,
      grant.toolName,
      grant.category,
      grant.scopeKey,
      grant.resourceKey,
      grant.fingerprint,
      grant.projectId,
      grant.projectLabel,
      grant.scope,
      grant.sessionId,
      grant.choice,
      grant.narrow ? 1 : 0,
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
    resourceKey: string;
    fingerprint: string;
    sessionId: string;
    now: number;
  }): Promise<PermissionGrantRecord | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${GRANT_COLUMNS} FROM permission_grants
       WHERE user_id = ? AND agent_id = ? AND tool_name = ? AND category = ?
         AND project_id = ? AND scope_key = ? AND resource_key = ? AND fingerprint = ?
         AND narrow = 1 AND status = 'active' AND revoked_at IS NULL
         AND risk NOT IN ('high', 'critical')
         AND ((scope = 'persistent') OR (scope = 'session' AND session_id = ?))
         AND (expires_at IS NULL OR expires_at > ?)
         AND (max_uses IS NULL OR use_count < max_uses)
         AND EXISTS (
           SELECT 1 FROM permission_requests r
           WHERE r.id = permission_grants.request_id
             AND r.status IN ('approved_once', 'approved_session', 'approved_always', 'auto_approved', 'completed')
         )
       ORDER BY created_at DESC LIMIT 1`,
      input.userId,
      input.agentId,
      input.toolName,
      input.category,
      input.projectId,
      input.scopeKey,
      input.resourceKey,
      input.fingerprint,
      input.sessionId,
      input.now
    )) as GrantRow | null;

    return row ? grantFromRow(row) : null;
  }

  async findActiveDenial(input: {
    userId: number;
    agentId: string;
    toolName: string;
    category: PermissionCategory;
    projectId: string;
    scopeKey: string;
    resourceKey: string;
  }): Promise<PermissionDenialRecord | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${DENIAL_COLUMNS} FROM permission_denials
       WHERE user_id = ? AND agent_id = ? AND tool_name = ? AND category = ?
         AND project_id = ? AND scope_key = ? AND resource_key = ?
         AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      input.userId,
      input.agentId,
      input.toolName,
      input.category,
      input.projectId,
      input.scopeKey,
      input.resourceKey
    )) as DenialRow | null;

    return row ? denialFromRow(row) : null;
  }

  async findAskEveryTime(input: {
    userId: number;
    agentId: string;
    toolName: string;
    category: PermissionCategory;
    projectId: string;
    scopeKey: string;
    resourceKey: string;
  }): Promise<PermissionPreferenceRecord | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT ${PREFERENCE_COLUMNS} FROM permission_preferences
       WHERE user_id = ? AND agent_id = ? AND tool_name = ? AND category = ?
         AND project_id = ? AND scope_key = ? AND resource_key = ?
         AND choice = 'ask_every_time' AND revoked_at IS NULL
       LIMIT 1`,
      input.userId,
      input.agentId,
      input.toolName,
      input.category,
      input.projectId,
      input.scopeKey,
      input.resourceKey
    )) as PreferenceRow | null;

    return row ? preferenceFromRow(row) : null;
  }

  async insertDenial(denial: PermissionDenialRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO permission_denials (
        id, user_id, agent_id, tool_name, category, project_id, scope_key,
        resource_key, reason, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      denial.id,
      denial.userId,
      denial.agentId,
      denial.toolName,
      denial.category,
      denial.projectId,
      denial.scopeKey,
      denial.resourceKey,
      denial.reason,
      denial.createdAt,
      denial.revokedAt
    );
  }

  async listDenials(userId: number, limit = 80): Promise<PermissionDenialRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${DENIAL_COLUMNS} FROM permission_denials
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      userId,
      limit
    )) as DenialRow[];

    return rows.map(denialFromRow);
  }

  async revokeDenial(userId: number, id: string, now: number): Promise<boolean> {
    const result = await this.db.runAsync(
      `UPDATE permission_denials SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      now,
      id,
      userId
    );

    return result.changes > 0;
  }

  async setAskEveryTime(preference: PermissionPreferenceRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO permission_preferences (
        user_id, agent_id, tool_name, category, project_id, scope_key,
        resource_key, choice, created_at, updated_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, agent_id, tool_name, category, project_id, scope_key, resource_key) DO UPDATE SET
        choice = excluded.choice,
        updated_at = excluded.updated_at,
        revoked_at = NULL`,
      preference.userId,
      preference.agentId,
      preference.toolName,
      preference.category,
      preference.projectId,
      preference.scopeKey,
      preference.resourceKey,
      preference.choice,
      preference.createdAt,
      preference.updatedAt,
      preference.revokedAt
    );
  }

  async listPreferences(userId: number, limit = 80): Promise<PermissionPreferenceRecord[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT ${PREFERENCE_COLUMNS} FROM permission_preferences
       WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
      userId,
      limit
    )) as PreferenceRow[];

    return rows.map(preferenceFromRow);
  }

  async revokePreference(
    userId: number,
    input: Pick<
      PermissionPreferenceRecord,
      'agentId' | 'toolName' | 'category' | 'projectId' | 'scopeKey' | 'resourceKey'
    >,
    now: number
  ): Promise<boolean> {
    const result = await this.db.runAsync(
      `UPDATE permission_preferences SET revoked_at = ?
       WHERE user_id = ? AND agent_id = ? AND tool_name = ? AND category = ?
         AND project_id = ? AND scope_key = ? AND resource_key = ? AND revoked_at IS NULL`,
      now,
      userId,
      input.agentId,
      input.toolName,
      input.category,
      input.projectId,
      input.scopeKey,
      input.resourceKey
    );

    return result.changes > 0;
  }

  async expireSessionGrants(sessionId: string, now: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE permission_grants SET status = 'expired', revoked_at = ?
       WHERE scope = 'session' AND session_id <> ? AND status = 'active'`,
      now,
      sessionId
    );
  }

  async revokeSessionGrants(userId: number, now: number): Promise<number> {
    const result = await this.db.runAsync(
      `UPDATE permission_grants SET status = 'revoked', revoked_at = ?
       WHERE user_id = ? AND scope = 'session' AND status = 'active'`,
      now,
      userId
    );

    return result.changes;
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
