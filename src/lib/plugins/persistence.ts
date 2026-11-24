import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  InstallHistoryAction,
  InstallHistoryRecord,
  PermissionAuditEvent,
  PermissionAuditRecord,
  PermissionGrantRecord,
  PermissionGrantSource,
  PersistedPlugin,
  PluginBackupRecord,
  PluginDependency,
  PluginHealth,
  PluginKvRecord,
  PluginPermission,
  PluginSettingRecord,
  PluginSource,
  PluginStatus,
  PluginTrustLevel,
} from './types';

export type InstallHistoryInput = {
  pluginId: string;
  action: InstallHistoryAction;
  fromVersion: string | null;
  toVersion: string | null;
  status: 'started' | 'succeeded' | 'failed';
  detail: string;
  createdAt?: number;
};

export type PermissionAuditInput = {
  pluginId: string;
  event: PermissionAuditEvent;
  permissions: PluginPermission[];
  source: PermissionGrantSource | 'system';
  detail: string;
  createdAt?: number;
};

/**
 * Persistence boundary for the plugin platform. The SQLite implementation is
 * used on device; tests and headless tooling use the in-memory implementation.
 * Nothing outside this module sees a raw database handle.
 */
export interface PluginPersistence {
  loadPlugins(): Promise<PersistedPlugin[]>;
  upsertPlugin(record: PersistedPlugin): Promise<void>;
  deletePlugin(pluginId: string): Promise<void>;
  saveVersion(
    pluginId: string,
    version: string,
    manifestJson: string,
    source: PluginSource
  ): Promise<void>;
  listVersions(
    pluginId: string
  ): Promise<{ version: string; installedAt: number }[]>;
  saveDependencies(pluginId: string, dependencies: PluginDependency[]): Promise<void>;
  listDependencies(pluginId: string): Promise<PluginDependency[]>;
  loadPermissions(): Promise<PermissionGrantRecord[]>;
  upsertPermission(record: PermissionGrantRecord): Promise<void>;
  deletePermission(pluginId: string, permission: PluginPermission): Promise<void>;
  appendPermissionAudit(input: PermissionAuditInput): Promise<PermissionAuditRecord>;
  listPermissionAudit(
    pluginId?: string,
    limit?: number
  ): Promise<PermissionAuditRecord[]>;
  appendInstallHistory(input: InstallHistoryInput): Promise<InstallHistoryRecord>;
  listInstallHistory(
    pluginId: string,
    limit?: number
  ): Promise<InstallHistoryRecord[]>;
  listAllInstallHistory(limit?: number): Promise<InstallHistoryRecord[]>;
  saveSetting(record: PluginSettingRecord): Promise<void>;
  listSettings(pluginId: string): Promise<PluginSettingRecord[]>;
  deleteSetting(pluginId: string, key: string): Promise<void>;
  deleteAllSettings(pluginId: string): Promise<void>;
  getKv(pluginId: string, key: string): Promise<PluginKvRecord | null>;
  setKv(record: PluginKvRecord): Promise<void>;
  deleteKv(pluginId: string, key: string): Promise<void>;
  listKv(pluginId: string): Promise<PluginKvRecord[]>;
  clearKv(pluginId: string): Promise<void>;
  kvBytes(pluginId: string): Promise<number>;
  saveBackup(record: Omit<PluginBackupRecord, 'id'>): Promise<PluginBackupRecord>;
  latestBackup(pluginId: string): Promise<PluginBackupRecord | null>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  transaction<T>(task: () => Promise<T>): Promise<T>;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: four bytes for the pair, skip the low surrogate.
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function parseHealth(value: string | null | undefined): PluginHealth {
  if (!value) {
    return {
      status: 'unknown',
      failures: 0,
      lastError: null,
      lastCheckedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(value) as Partial<PluginHealth>;

    return {
      status:
        parsed.status === 'healthy' ||
        parsed.status === 'degraded' ||
        parsed.status === 'failing'
          ? parsed.status
          : 'unknown',
      failures: typeof parsed.failures === 'number' ? parsed.failures : 0,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      lastCheckedAt:
        typeof parsed.lastCheckedAt === 'number' ? parsed.lastCheckedAt : null,
    };
  } catch {
    return {
      status: 'unknown',
      failures: 0,
      lastError: null,
      lastCheckedAt: null,
    };
  }
}

type PluginRow = {
  plugin_id: string;
  manifest: string;
  trust_level: string;
  source: string;
  status: string;
  enabled: number;
  installed_at: number;
  updated_at: number;
  last_started_at: number | null;
  last_stopped_at: number | null;
  error: string | null;
  health_json: string | null;
  legacy: number;
};

type PermissionRow = {
  plugin_id: string;
  permission: string;
  granted: number;
  source: string;
  granted_at: number;
  revoked_at: number | null;
};

type AuditRow = {
  id: number;
  plugin_id: string;
  event: string;
  permissions: string;
  source: string;
  detail: string;
  created_at: number;
};

type HistoryRow = {
  id: number;
  plugin_id: string;
  action: string;
  from_version: string | null;
  to_version: string | null;
  status: string;
  detail: string;
  created_at: number;
};

type SettingRow = {
  plugin_id: string;
  key: string;
  value: string;
  updated_at: number;
};

type KvRow = {
  plugin_id: string;
  key: string;
  value: string;
  updated_at: number;
  bytes: number;
};

function pluginFromRow(row: PluginRow): PersistedPlugin {
  return {
    manifest: JSON.parse(row.manifest) as PersistedPlugin['manifest'],
    manifestJson: row.manifest,
    trustLevel: row.trust_level as PluginTrustLevel,
    source: row.source as PluginSource,
    status: row.status as PluginStatus,
    enabled: row.enabled === 1,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    lastStartedAt: row.last_started_at,
    lastStoppedAt: row.last_stopped_at,
    error: row.error,
    health: parseHealth(row.health_json),
    legacy: row.legacy === 1,
  };
}

export class SqlitePluginPersistence implements PluginPersistence {
  constructor(private readonly db: SQLiteDatabase) {}

  async loadPlugins(): Promise<PersistedPlugin[]> {
    const rows = await this.db.getAllAsync<PluginRow>(
      `SELECT plugin_id, manifest, trust_level, source, status, enabled,
              installed_at, updated_at, last_started_at, last_stopped_at,
              error, health_json, legacy
       FROM plugin_records
       ORDER BY plugin_id ASC`
    );

    return rows.map(pluginFromRow);
  }

  async upsertPlugin(record: PersistedPlugin): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plugin_records (
         plugin_id, name, version, manifest, trust_level, source, status,
         enabled, installed_at, updated_at, last_started_at, last_stopped_at,
         error, health_json, data_schema_version, legacy
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plugin_id) DO UPDATE SET
         name = excluded.name,
         version = excluded.version,
         manifest = excluded.manifest,
         trust_level = excluded.trust_level,
         source = excluded.source,
         status = excluded.status,
         enabled = excluded.enabled,
         installed_at = excluded.installed_at,
         updated_at = excluded.updated_at,
         last_started_at = excluded.last_started_at,
         last_stopped_at = excluded.last_stopped_at,
         error = excluded.error,
         health_json = excluded.health_json,
         data_schema_version = excluded.data_schema_version,
         legacy = excluded.legacy`,
      record.manifest.pluginId,
      record.manifest.name,
      record.manifest.version,
      record.manifestJson,
      record.trustLevel,
      record.source,
      record.status,
      record.enabled ? 1 : 0,
      record.installedAt,
      record.updatedAt,
      record.lastStartedAt,
      record.lastStoppedAt,
      record.error,
      JSON.stringify(record.health),
      record.manifest.dataSchemaVersion,
      record.legacy ? 1 : 0
    );
  }

  async deletePlugin(pluginId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM plugin_records WHERE plugin_id = ?', pluginId);
    await this.db.runAsync('DELETE FROM plugin_dependencies WHERE plugin_id = ?', pluginId);
  }

  async saveVersion(
    pluginId: string,
    version: string,
    manifestJson: string,
    source: PluginSource
  ): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plugin_versions (plugin_id, version, manifest, source, installed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(plugin_id, version) DO UPDATE SET
         manifest = excluded.manifest,
         source = excluded.source,
         installed_at = excluded.installed_at`,
      pluginId,
      version,
      manifestJson,
      source,
      Date.now()
    );
  }

  async listVersions(
    pluginId: string
  ): Promise<{ version: string; installedAt: number }[]> {
    return this.db.getAllAsync<{ version: string; installedAt: number }>(
      `SELECT version, installed_at AS installedAt
       FROM plugin_versions
       WHERE plugin_id = ?
       ORDER BY installed_at DESC`,
      pluginId
    );
  }

  async saveDependencies(
    pluginId: string,
    dependencies: PluginDependency[]
  ): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM plugin_dependencies WHERE plugin_id = ?',
      pluginId
    );

    for (const dependency of dependencies) {
      await this.db.runAsync(
        `INSERT INTO plugin_dependencies (plugin_id, dependency_id, version_range, optional)
         VALUES (?, ?, ?, ?)`,
        pluginId,
        dependency.pluginId,
        dependency.version,
        0
      );
    }
  }

  async listDependencies(pluginId: string): Promise<PluginDependency[]> {
    const rows = await this.db.getAllAsync<{
      dependency_id: string;
      version_range: string;
    }>(
      `SELECT dependency_id, version_range
       FROM plugin_dependencies
       WHERE plugin_id = ? AND optional = 0
       ORDER BY dependency_id`,
      pluginId
    );

    return rows.map((row) => ({
      pluginId: row.dependency_id,
      version: row.version_range,
    }));
  }

  async loadPermissions(): Promise<PermissionGrantRecord[]> {
    const rows = await this.db.getAllAsync<PermissionRow>(
      `SELECT plugin_id, permission, granted, source, granted_at, revoked_at
       FROM plugin_permissions
       ORDER BY plugin_id, permission`
    );

    return rows.map((row) => ({
      pluginId: row.plugin_id,
      permission: row.permission as PluginPermission,
      granted: row.granted === 1,
      source: row.source as PermissionGrantSource,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
    }));
  }

  async upsertPermission(record: PermissionGrantRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plugin_permissions (
         plugin_id, permission, granted, source, granted_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(plugin_id, permission) DO UPDATE SET
         granted = excluded.granted,
         source = excluded.source,
         granted_at = excluded.granted_at,
         revoked_at = excluded.revoked_at`,
      record.pluginId,
      record.permission,
      record.granted ? 1 : 0,
      record.source,
      record.grantedAt,
      record.revokedAt
    );
  }

  async deletePermission(pluginId: string, permission: PluginPermission): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM plugin_permissions WHERE plugin_id = ? AND permission = ?',
      pluginId,
      permission
    );
  }

  async appendPermissionAudit(
    input: PermissionAuditInput
  ): Promise<PermissionAuditRecord> {
    const createdAt = input.createdAt ?? Date.now();
    const result = await this.db.runAsync(
      `INSERT INTO plugin_permission_audit (
         plugin_id, event, permissions, source, detail, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      input.pluginId,
      input.event,
      JSON.stringify(input.permissions),
      input.source,
      input.detail,
      createdAt
    );

    return {
      id: Number(result.lastInsertRowId ?? 0),
      pluginId: input.pluginId,
      event: input.event,
      permissions: input.permissions,
      source: input.source,
      detail: input.detail,
      createdAt,
    };
  }

  async listPermissionAudit(
    pluginId?: string,
    limit = 200
  ): Promise<PermissionAuditRecord[]> {
    const rows = pluginId
      ? await this.db.getAllAsync<AuditRow>(
          `SELECT id, plugin_id, event, permissions, source, detail, created_at
           FROM plugin_permission_audit
           WHERE plugin_id = ?
           ORDER BY id DESC
           LIMIT ?`,
          pluginId,
          limit
        )
      : await this.db.getAllAsync<AuditRow>(
          `SELECT id, plugin_id, event, permissions, source, detail, created_at
           FROM plugin_permission_audit
           ORDER BY id DESC
           LIMIT ?`,
          limit
        );

    return rows.map((row) => ({
      id: row.id,
      pluginId: row.plugin_id,
      event: row.event as PermissionAuditEvent,
      permissions: JSON.parse(row.permissions) as PluginPermission[],
      source: row.source as PermissionAuditRecord['source'],
      detail: row.detail,
      createdAt: row.created_at,
    }));
  }

  async appendInstallHistory(
    input: InstallHistoryInput
  ): Promise<InstallHistoryRecord> {
    const createdAt = input.createdAt ?? Date.now();
    const result = await this.db.runAsync(
      `INSERT INTO plugin_install_history (
         plugin_id, action, from_version, to_version, status, detail, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.pluginId,
      input.action,
      input.fromVersion,
      input.toVersion,
      input.status,
      input.detail,
      createdAt
    );

    return {
      id: Number(result.lastInsertRowId ?? 0),
      pluginId: input.pluginId,
      action: input.action,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      status: input.status,
      detail: input.detail,
      createdAt,
    };
  }

  async listInstallHistory(
    pluginId: string,
    limit = 100
  ): Promise<InstallHistoryRecord[]> {
    const rows = await this.db.getAllAsync<HistoryRow>(
      `SELECT id, plugin_id, action, from_version, to_version, status, detail, created_at
       FROM plugin_install_history
       WHERE plugin_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      pluginId,
      limit
    );

    return rows.map(mapHistoryRow);
  }

  async listAllInstallHistory(limit = 200): Promise<InstallHistoryRecord[]> {
    const rows = await this.db.getAllAsync<HistoryRow>(
      `SELECT id, plugin_id, action, from_version, to_version, status, detail, created_at
       FROM plugin_install_history
       ORDER BY id DESC
       LIMIT ?`,
      limit
    );

    return rows.map(mapHistoryRow);
  }

  async saveSetting(record: PluginSettingRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plugin_settings (plugin_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      record.pluginId,
      record.key,
      JSON.stringify(record.value),
      record.updatedAt
    );
  }

  async listSettings(pluginId: string): Promise<PluginSettingRecord[]> {
    const rows = await this.db.getAllAsync<SettingRow>(
      `SELECT plugin_id, key, value, updated_at
       FROM plugin_settings
       WHERE plugin_id = ?
       ORDER BY key`,
      pluginId
    );

    return rows.map((row) => ({
      pluginId: row.plugin_id,
      key: row.key,
      value: JSON.parse(row.value) as unknown,
      updatedAt: row.updated_at,
    }));
  }

  async deleteSetting(pluginId: string, key: string): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM plugin_settings WHERE plugin_id = ? AND key = ?',
      pluginId,
      key
    );
  }

  async deleteAllSettings(pluginId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM plugin_settings WHERE plugin_id = ?', pluginId);
  }

  async getKv(pluginId: string, key: string): Promise<PluginKvRecord | null> {
    const row = await this.db.getFirstAsync<KvRow>(
      `SELECT plugin_id, key, value, updated_at, bytes
       FROM plugin_kv WHERE plugin_id = ? AND key = ?`,
      pluginId,
      key
    );

    return row
      ? {
          pluginId: row.plugin_id,
          key: row.key,
          value: row.value,
          updatedAt: row.updated_at,
          bytes: row.bytes,
        }
      : null;
  }

  async setKv(record: PluginKvRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plugin_kv (plugin_id, key, value, updated_at, bytes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         bytes = excluded.bytes`,
      record.pluginId,
      record.key,
      record.value,
      record.updatedAt,
      record.bytes
    );
  }

  async deleteKv(pluginId: string, key: string): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ?',
      pluginId,
      key
    );
  }

  async listKv(pluginId: string): Promise<PluginKvRecord[]> {
    const rows = await this.db.getAllAsync<KvRow>(
      `SELECT plugin_id, key, value, updated_at, bytes
       FROM plugin_kv WHERE plugin_id = ? ORDER BY key`,
      pluginId
    );

    return rows.map((row) => ({
      pluginId: row.plugin_id,
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
      bytes: row.bytes,
    }));
  }

  async clearKv(pluginId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM plugin_kv WHERE plugin_id = ?', pluginId);
  }

  async kvBytes(pluginId: string): Promise<number> {
    const row = await this.db.getFirstAsync<{ total: number | null }>(
      'SELECT SUM(bytes) AS total FROM plugin_kv WHERE plugin_id = ?',
      pluginId
    );

    return row?.total ?? 0;
  }

  async saveBackup(
    record: Omit<PluginBackupRecord, 'id'>
  ): Promise<PluginBackupRecord> {
    const result = await this.db.runAsync(
      `INSERT INTO plugin_backups (plugin_id, from_version, to_version, data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      record.pluginId,
      record.fromVersion,
      record.toVersion,
      record.data,
      record.createdAt
    );

    return { ...record, id: Number(result.lastInsertRowId ?? 0) };
  }

  async latestBackup(pluginId: string): Promise<PluginBackupRecord | null> {
    const row = await this.db.getFirstAsync<{
      id: number;
      plugin_id: string;
      from_version: string;
      to_version: string;
      data: string;
      created_at: number;
    }>(
      `SELECT id, plugin_id, from_version, to_version, data, created_at
       FROM plugin_backups
       WHERE plugin_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      pluginId
    );

    return row
      ? {
          id: row.id,
          pluginId: row.plugin_id,
          fromVersion: row.from_version,
          toVersion: row.to_version,
          data: row.data,
          createdAt: row.created_at,
        }
      : null;
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM plugin_meta WHERE key = ?',
      key
    );

    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plugin_meta (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      key,
      value,
      Date.now()
    );
  }

  async transaction<T>(task: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    await this.db.withTransactionAsync(async () => {
      result = await task();
    });

    if (result === undefined) {
      throw new Error('Plugin transaction completed without a result.');
    }

    return result;
  }
}

function mapHistoryRow(row: HistoryRow): InstallHistoryRecord {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    action: row.action as InstallHistoryAction,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    status: row.status as InstallHistoryRecord['status'],
    detail: row.detail,
    createdAt: row.created_at,
  };
}

type MemoryState = {
  plugins: Map<string, PersistedPlugin>;
  versions: Map<string, { version: string; installedAt: number }[]>;
  dependencies: Map<string, PluginDependency[]>;
  permissions: Map<string, PermissionGrantRecord>;
  audits: PermissionAuditRecord[];
  history: InstallHistoryRecord[];
  settings: Map<string, PluginSettingRecord>;
  kv: Map<string, PluginKvRecord>;
  backups: PluginBackupRecord[];
  meta: Map<string, string>;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Deterministic in-memory implementation for tests and headless tooling. */
export class MemoryPluginPersistence implements PluginPersistence {
  private state: MemoryState = {
    plugins: new Map(),
    versions: new Map(),
    dependencies: new Map(),
    permissions: new Map(),
    audits: [],
    history: [],
    settings: new Map(),
    kv: new Map(),
    backups: [],
    meta: new Map(),
  };

  private nextAuditId = 1;
  private nextHistoryId = 1;
  private nextBackupId = 1;

  async loadPlugins(): Promise<PersistedPlugin[]> {
    return Array.from(this.state.plugins.values(), (record) => clone(record));
  }

  async upsertPlugin(record: PersistedPlugin): Promise<void> {
    this.state.plugins.set(record.manifest.pluginId, clone(record));
  }

  async deletePlugin(pluginId: string): Promise<void> {
    this.state.plugins.delete(pluginId);
    this.state.dependencies.delete(pluginId);
  }

  async saveVersion(
    pluginId: string,
    version: string,
    _manifestJson: string,
    _source: PluginSource
  ): Promise<void> {
    const versions = this.state.versions.get(pluginId) ?? [];
    this.state.versions.set(pluginId, [
      { version, installedAt: Date.now() },
      ...versions.filter((entry) => entry.version !== version),
    ]);
  }

  async listVersions(
    pluginId: string
  ): Promise<{ version: string; installedAt: number }[]> {
    return clone(this.state.versions.get(pluginId) ?? []);
  }

  async saveDependencies(
    pluginId: string,
    dependencies: PluginDependency[]
  ): Promise<void> {
    this.state.dependencies.set(pluginId, clone(dependencies));
  }

  async listDependencies(pluginId: string): Promise<PluginDependency[]> {
    return clone(this.state.dependencies.get(pluginId) ?? []);
  }

  async loadPermissions(): Promise<PermissionGrantRecord[]> {
    return Array.from(this.state.permissions.values(), (record) => clone(record));
  }

  async upsertPermission(record: PermissionGrantRecord): Promise<void> {
    this.state.permissions.set(
      `${record.pluginId}::${record.permission}`,
      clone(record)
    );
  }

  async deletePermission(pluginId: string, permission: PluginPermission): Promise<void> {
    this.state.permissions.delete(`${pluginId}::${permission}`);
  }

  async appendPermissionAudit(
    input: PermissionAuditInput
  ): Promise<PermissionAuditRecord> {
    const record: PermissionAuditRecord = {
      id: this.nextAuditId,
      pluginId: input.pluginId,
      event: input.event,
      permissions: [...input.permissions],
      source: input.source,
      detail: input.detail,
      createdAt: input.createdAt ?? Date.now(),
    };
    this.nextAuditId += 1;
    this.state.audits.push(record);
    return clone(record);
  }

  async listPermissionAudit(
    pluginId?: string,
    limit = 200
  ): Promise<PermissionAuditRecord[]> {
    const records = this.state.audits
      .filter((record) => !pluginId || record.pluginId === pluginId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);

    return clone(records);
  }

  async appendInstallHistory(
    input: InstallHistoryInput
  ): Promise<InstallHistoryRecord> {
    const record: InstallHistoryRecord = {
      id: this.nextHistoryId,
      pluginId: input.pluginId,
      action: input.action,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      status: input.status,
      detail: input.detail,
      createdAt: input.createdAt ?? Date.now(),
    };
    this.nextHistoryId += 1;
    this.state.history.push(record);
    return clone(record);
  }

  async listInstallHistory(
    pluginId: string,
    limit = 100
  ): Promise<InstallHistoryRecord[]> {
    return clone(
      this.state.history
        .filter((record) => record.pluginId === pluginId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
    );
  }

  async listAllInstallHistory(limit = 200): Promise<InstallHistoryRecord[]> {
    return clone(this.state.history.sort((a, b) => b.id - a.id).slice(0, limit));
  }

  async saveSetting(record: PluginSettingRecord): Promise<void> {
    this.state.settings.set(
      `${record.pluginId}::${record.key}`,
      clone(record)
    );
  }

  async listSettings(pluginId: string): Promise<PluginSettingRecord[]> {
    return clone(
      Array.from(this.state.settings.values())
        .filter((record) => record.pluginId === pluginId)
        .sort((a, b) => a.key.localeCompare(b.key))
    );
  }

  async deleteSetting(pluginId: string, key: string): Promise<void> {
    this.state.settings.delete(`${pluginId}::${key}`);
  }

  async deleteAllSettings(pluginId: string): Promise<void> {
    for (const [key, record] of this.state.settings) {
      if (record.pluginId === pluginId) {
        this.state.settings.delete(key);
      }
    }
  }

  async getKv(pluginId: string, key: string): Promise<PluginKvRecord | null> {
    const record = this.state.kv.get(`${pluginId}::${key}`);
    return record ? clone(record) : null;
  }

  async setKv(record: PluginKvRecord): Promise<void> {
    this.state.kv.set(`${record.pluginId}::${record.key}`, clone(record));
  }

  async deleteKv(pluginId: string, key: string): Promise<void> {
    this.state.kv.delete(`${pluginId}::${key}`);
  }

  async listKv(pluginId: string): Promise<PluginKvRecord[]> {
    return clone(
      Array.from(this.state.kv.values())
        .filter((record) => record.pluginId === pluginId)
        .sort((a, b) => a.key.localeCompare(b.key))
    );
  }

  async clearKv(pluginId: string): Promise<void> {
    for (const [key, record] of this.state.kv) {
      if (record.pluginId === pluginId) {
        this.state.kv.delete(key);
      }
    }
  }

  async kvBytes(pluginId: string): Promise<number> {
    return Array.from(this.state.kv.values())
      .filter((record) => record.pluginId === pluginId)
      .reduce((total, record) => total + record.bytes, 0);
  }

  async saveBackup(
    record: Omit<PluginBackupRecord, 'id'>
  ): Promise<PluginBackupRecord> {
    const saved = { ...record, id: this.nextBackupId };
    this.nextBackupId += 1;
    this.state.backups.push(clone(saved));
    return saved;
  }

  async latestBackup(pluginId: string): Promise<PluginBackupRecord | null> {
    const backup = this.state.backups
      .filter((record) => record.pluginId === pluginId)
      .sort((a, b) => b.id - a.id)[0];

    return backup ? clone(backup) : null;
  }

  async getMeta(key: string): Promise<string | null> {
    return this.state.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.state.meta.set(key, value);
  }

  async transaction<T>(task: () => Promise<T>): Promise<T> {
    const snapshot = clone(this.state);

    try {
      return await task();
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }
}
