import type { PermissionGrantRecord, PermissionGrantSource, PluginPermission } from './types';
import { PLUGIN_PERMISSIONS } from './types';
import type { PluginPersistence } from './persistence';

export type PluginPermissionRisk = 'low' | 'medium' | 'high';

export type PluginPermissionMeta = {
  permission: PluginPermission;
  label: string;
  description: string;
  risk: PluginPermissionRisk;
  sensitive: boolean;
};

export const PLUGIN_PERMISSION_META: Record<
  PluginPermission,
  PluginPermissionMeta
> = {
  'network.access': {
    permission: 'network.access',
    label: 'Network access',
    description: 'Send and receive data over approved network APIs.',
    risk: 'medium',
    sensitive: false,
  },
  'storage.read': {
    permission: 'storage.read',
    label: 'Read plugin storage',
    description: 'Read data in this plugin’s own storage namespace.',
    risk: 'low',
    sensitive: false,
  },
  'storage.write': {
    permission: 'storage.write',
    label: 'Write plugin storage',
    description: 'Create and change data in this plugin’s own storage namespace.',
    risk: 'low',
    sensitive: false,
  },
  'files.read': {
    permission: 'files.read',
    label: 'Read files',
    description: 'Reserved declaration for reading approved files. The current SDK exposes no file API.',
    risk: 'medium',
    sensitive: false,
  },
  'files.write': {
    permission: 'files.write',
    label: 'Write files',
    description: 'Reserved declaration for writing approved files. The current SDK exposes no file API.',
    risk: 'high',
    sensitive: true,
  },
  'notifications.send': {
    permission: 'notifications.send',
    label: 'Send notifications',
    description: 'Post notifications to the device notification tray.',
    risk: 'medium',
    sensitive: false,
  },
  'camera.access': {
    permission: 'camera.access',
    label: 'Camera',
    description: 'Use the device camera.',
    risk: 'high',
    sensitive: true,
  },
  'microphone.access': {
    permission: 'microphone.access',
    label: 'Microphone',
    description: 'Record audio from the device microphone.',
    risk: 'high',
    sensitive: true,
  },
  'location.access': {
    permission: 'location.access',
    label: 'Location',
    description: 'Read the device’s approximate or precise location.',
    risk: 'high',
    sensitive: true,
  },
  'contacts.read': {
    permission: 'contacts.read',
    label: 'Contacts',
    description: 'Read contact names and details.',
    risk: 'high',
    sensitive: true,
  },
  'calendar.read': {
    permission: 'calendar.read',
    label: 'Read calendar',
    description: 'Read calendar events.',
    risk: 'high',
    sensitive: true,
  },
  'calendar.write': {
    permission: 'calendar.write',
    label: 'Write calendar',
    description: 'Create or change calendar events.',
    risk: 'high',
    sensitive: true,
  },
  'clipboard.read': {
    permission: 'clipboard.read',
    label: 'Read clipboard',
    description: 'Read the current clipboard contents.',
    risk: 'high',
    sensitive: true,
  },
  'clipboard.write': {
    permission: 'clipboard.write',
    label: 'Write clipboard',
    description: 'Replace the clipboard contents.',
    risk: 'medium',
    sensitive: false,
  },
  'ai.invoke': {
    permission: 'ai.invoke',
    label: 'Register AI tools',
    description: 'Offer tools to the Orbit agent and run them on request.',
    risk: 'high',
    sensitive: true,
  },
  'ai.context.read': {
    permission: 'ai.context.read',
    label: 'Read AI context',
    description: 'Read non-secret context supplied for the current AI turn.',
    risk: 'high',
    sensitive: true,
  },
  'mcp.connect': {
    permission: 'mcp.connect',
    label: 'Connect to MCP',
    description: 'Connect to a configured MCP server and expose its tools.',
    risk: 'medium',
    sensitive: false,
  },
  'credentials.request': {
    permission: 'credentials.request',
    label: 'Plugin credentials',
    description: 'Store and read credentials for this plugin in secure storage.',
    risk: 'high',
    sensitive: true,
  },
  'background.execute': {
    permission: 'background.execute',
    label: 'Background execution',
    description: 'Run scheduled work while Orbit is in the background.',
    risk: 'high',
    sensitive: true,
  },
  'ui.contribute': {
    permission: 'ui.contribute',
    label: 'Contribute UI',
    description: 'Add sidebar entries, widgets, settings sections and plugin-home actions.',
    risk: 'low',
    sensitive: false,
  },
  'sandbox.execute': {
    permission: 'sandbox.execute',
    label: 'Run in sandbox',
    description: 'Run a deterministic program in the Android isolated sandbox. The program cannot access files, network or device permissions.',
    risk: 'high',
    sensitive: true,
  },
};

export function isPluginPermission(value: unknown): value is PluginPermission {
  return (
    typeof value === 'string' &&
    (PLUGIN_PERMISSIONS as readonly string[]).includes(value)
  );
}

export function permissionRisk(permission: PluginPermission): PluginPermissionRisk {
  return PLUGIN_PERMISSION_META[permission].risk;
}

export function isSensitivePermission(permission: PluginPermission): boolean {
  return PLUGIN_PERMISSION_META[permission].sensitive;
}

export class PluginPermissionError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly permission: PluginPermission,
    message?: string
  ) {
    super(
      message ??
        `Plugin "${pluginId}" does not have the "${permission}" permission.`
    );
    this.name = 'PluginPermissionError';
  }
}

export class MissingPluginPermissionsError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly missing: PluginPermission[]
  ) {
    super(
      `Plugin "${pluginId}" needs approval for: ${missing.join(', ')}.`
    );
    this.name = 'MissingPluginPermissionsError';
  }
}

/**
 * Granular, default-deny permission manager for plugins. Grants are kept
 * separately from agent tool permissions (which are scoped to an agent, tool,
 * project and use count). A grant here never implies a grant there.
 */
export class PluginPermissionManager {
  private grants = new Map<string, PermissionGrantRecord>();
  private loaded = false;

  constructor(
    private readonly persistence: PluginPersistence,
    private readonly now: () => number = () => Date.now()
  ) {}

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const records = await this.persistence.loadPermissions();
    this.grants.clear();

    for (const record of records) {
      this.grants.set(this.key(record.pluginId, record.permission), record);
    }

    this.loaded = true;
  }

  private key(pluginId: string, permission: PluginPermission): string {
    return `${pluginId}::${permission}`;
  }

  activeGrants(pluginId: string): PluginPermission[] {
    return Array.from(this.grants.values())
      .filter((record) => record.pluginId === pluginId && record.granted)
      .map((record) => record.permission)
      .sort();
  }

  getRecord(
    pluginId: string,
    permission: PluginPermission
  ): PermissionGrantRecord | null {
    return this.grants.get(this.key(pluginId, permission)) ?? null;
  }

  has(pluginId: string, permission: PluginPermission): boolean {
    return this.getRecord(pluginId, permission)?.granted === true;
  }

  hasEverGranted(pluginId: string, permission: PluginPermission): boolean {
    const record = this.getRecord(pluginId, permission);
    return Boolean(record && record.grantedAt > 0);
  }

  isRevoked(pluginId: string, permission: PluginPermission): boolean {
    const record = this.getRecord(pluginId, permission);
    return Boolean(record && !record.granted && record.revokedAt !== null);
  }

  missing(
    pluginId: string,
    requested: readonly PluginPermission[]
  ): PluginPermission[] {
    return requested.filter((permission) => !this.has(pluginId, permission));
  }

  assert(pluginId: string, permission: PluginPermission): void {
    if (!this.has(pluginId, permission)) {
      throw new PluginPermissionError(pluginId, permission);
    }
  }

  async grant(
    pluginId: string,
    permissions: readonly PluginPermission[],
    source: PermissionGrantSource,
    detail: string
  ): Promise<PluginPermission[]> {
    const now = this.now();
    const newlyGranted: PluginPermission[] = [];

    for (const permission of permissions) {
      if (!isPluginPermission(permission)) {
        throw new Error(`Unknown plugin permission "${String(permission)}".`);
      }

      const existing = this.getRecord(pluginId, permission);

      if (existing?.granted) {
        continue;
      }

      const record: PermissionGrantRecord = {
        pluginId,
        permission,
        granted: true,
        source,
        grantedAt: now,
        revokedAt: null,
      };

      this.grants.set(this.key(pluginId, permission), record);
      await this.persistence.upsertPermission(record);
      newlyGranted.push(permission);
    }

    if (newlyGranted.length > 0) {
      await this.persistence.appendPermissionAudit({
        pluginId,
        event: 'permissions_granted',
        permissions: newlyGranted,
        source,
        detail,
        createdAt: now,
      });
    }

    return newlyGranted;
  }

  /**
   * Records the user's decision for a permission request. Anything not in the
   * approval list stays denied. This is the only path that accepts user
   * consent; trust level itself never grants a permission.
   */
  async approve(
    pluginId: string,
    requested: readonly PluginPermission[],
    approved: readonly PluginPermission[],
    source: PermissionGrantSource = 'user'
  ): Promise<{ granted: PluginPermission[]; denied: PluginPermission[] }> {
    const requestedSet = new Set(requested);
    const invalid = approved.filter((permission) => !requestedSet.has(permission));

    if (invalid.length > 0) {
      throw new Error(
        `Cannot approve permissions that were not requested: ${invalid.join(', ')}.`
      );
    }

    const denied = requested.filter((permission) => !approved.includes(permission));
    const now = this.now();

    if (denied.length > 0) {
      await this.persistence.appendPermissionAudit({
        pluginId,
        event: 'permissions_denied',
        permissions: denied,
        source: 'system',
        detail: 'User did not approve these permissions.',
        createdAt: now,
      });
    }

    const granted = await this.grant(
      pluginId,
      approved,
      source,
      'User approved plugin permissions.'
    );

    return { granted, denied };
  }

  async revoke(
    pluginId: string,
    permission: PluginPermission,
    reason = 'Revoked by the user.'
  ): Promise<void> {
    const now = this.now();
    const existing = this.getRecord(pluginId, permission);
    const record: PermissionGrantRecord = {
      pluginId,
      permission,
      granted: false,
      source: existing?.source ?? 'user',
      grantedAt: existing?.grantedAt ?? now,
      revokedAt: now,
    };

    this.grants.set(this.key(pluginId, permission), record);
    await this.persistence.upsertPermission(record);
    await this.persistence.appendPermissionAudit({
      pluginId,
      event: 'permission_revoked',
      permissions: [permission],
      source: 'user',
      detail: reason,
      createdAt: now,
    });
  }

  async revokeAll(pluginId: string, reason: string): Promise<void> {
    const active = this.activeGrants(pluginId);

    for (const permission of active) {
      await this.revoke(pluginId, permission, reason);
    }

    if (active.length > 0) {
      await this.persistence.appendPermissionAudit({
        pluginId,
        event: 'permissions_revoked_all',
        permissions: active,
        source: 'user',
        detail: reason,
        createdAt: this.now(),
      });
    }
  }

  async audit(pluginId: string, limit?: number) {
    return this.persistence.listPermissionAudit(pluginId, limit);
  }
}

export function permissionSummary(permissions: readonly PluginPermission[]): string {
  if (permissions.length === 0) {
    return 'No permissions requested.';
  }

  return permissions
    .map((permission) => PLUGIN_PERMISSION_META[permission].label)
    .join(' · ');
}
