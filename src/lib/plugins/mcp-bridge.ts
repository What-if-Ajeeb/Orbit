import type { McpServerConfig } from '@/lib/mcp/settings';

import type { PluginPermissionManager } from './permissions';
import type { PluginRegistry } from './registry';
import type {
  PluginManifest,
  PluginPermission,
  PluginPlatform,
} from './types';

// Not in RESERVED_PLUGIN_ID_PREFIXES: synthetic MCP records are created from
// local settings with trust level "local", not from the reviewed official path.
export const MCP_PLUGIN_PREFIX = 'mcp.server.';

const ALL_PLATFORMS: PluginPlatform[] = ['android', 'ios', 'web'];
const MCP_PLUGIN_VERSION = '1.0.0';

export function mcpPluginId(serverId: string): string {
  const slug = serverId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `${MCP_PLUGIN_PREFIX}${slug || 'server'}`;
}

export function isMcpPluginId(pluginId: string): boolean {
  return pluginId.startsWith(MCP_PLUGIN_PREFIX);
}

/**
 * Each configured MCP server becomes a synthetic integration plugin. The
 * server's tools stay owned by `mcp/registry.ts`; this manifest only makes the
 * connection visible, auditable and revocable in the Plugin Manager.
 */
export function buildMcpPluginManifest(server: McpServerConfig): PluginManifest {
  return {
    manifestVersion: 1,
    pluginId: mcpPluginId(server.id),
    name: server.name || 'MCP server',
    version: MCP_PLUGIN_VERSION,
    description: `Configured MCP server at ${server.url.replace(/\/\/[^/]+/, '//…')}. Tools are exposed to the agent only while this integration is enabled.`,
    author: { name: 'MCP server configuration' },
    publisher: {
      id: 'local.mcp',
      name: 'Configured by you',
      verified: false,
    },
    category: 'mcp',
    icon: 'extension-puzzle-outline',
    minimumOrbitVersion: '1.0.0',
    platformSupport: ALL_PLATFORMS,
    entryPoint: { kind: 'mcp', serverId: server.id },
    permissions: ['mcp.connect', 'ai.invoke'],
    capabilities: ['integration.mcp', 'tools.mcp'],
    dependencies: [],
    optionalDependencies: [],
    routes: [],
    navigationEntries: [],
    dashboardWidgets: [],
    settingsSections: [],
    settingsSchema: [],
    toolbarActions: [],
    contextActions: [],
    mcpTools: [],
    events: { emits: [], listens: [] },
    lifecycleHooks: [],
    dataSchemaVersion: 1,
    updatePolicy: 'manual',
  };
}

export type McpPluginSyncResult = {
  connected: string[];
  blocked: string[];
};

/**
 * Mirrors MCP server configuration into plugin records.
 *
 * A server the user configured is a consent signal, so `mcp.connect` and
 * `ai.invoke` are granted with the auditable `mcp_settings` source the first
 * time the server is seen. If the user later revokes either permission, this
 * function never re-grants it automatically; the integration stays disabled
 * until the user approves it in the Plugin Manager.
 */
export async function syncMcpPluginRecords(input: {
  registry: PluginRegistry;
  permissions: PluginPermissionManager;
  servers: McpServerConfig[];
}): Promise<McpPluginSyncResult> {
  const { registry, permissions, servers } = input;
  const connected: string[] = [];
  const blocked: string[] = [];
  const seen = new Set<string>();

  for (const server of servers) {
    const manifest = buildMcpPluginManifest(server);
    seen.add(manifest.pluginId);

    const required: PluginPermission[] = manifest.permissions;
    let denied = false;

    for (const permission of required) {
      if (permissions.has(manifest.pluginId, permission)) {
        continue;
      }

      if (permissions.getRecord(manifest.pluginId, permission)) {
        // The user explicitly revoked this permission; do not regrant.
        denied = true;
        continue;
      }

      await permissions.grant(
        manifest.pluginId,
        [permission],
        'mcp_settings',
        `Granted because MCP server "${server.name}" is configured in Orbit settings.`
      );
    }

    const enabled = server.enabled && server.url.trim().length > 0 && !denied;

    await registry.adopt(manifest, {
      trustLevel: 'local',
      source: 'local',
      status: enabled ? 'running' : 'disabled',
      enabled,
      detail: enabled
        ? `MCP server "${server.name}" connected from settings.`
        : denied
          ? `MCP server "${server.name}" is configured, but a required permission was revoked.`
          : `MCP server "${server.name}" is configured but disabled.`,
    });

    if (enabled) {
      connected.push(manifest.pluginId);
    } else {
      blocked.push(manifest.pluginId);
    }
  }

  for (const record of registry.listAll()) {
    if (record.manifest.entryPoint.kind !== 'mcp') {
      continue;
    }

    if (!seen.has(record.manifest.pluginId) && record.status === 'running') {
      await registry.adopt(record.manifest, {
        trustLevel: record.trustLevel,
        source: record.source,
        status: 'disabled',
        enabled: false,
        detail: 'MCP server is no longer configured; the integration was disabled.',
      });
    }
  }

  return { connected, blocked };
}

/**
 * Dynamic gate used by the MCP tool registry. A tool may run only while its
 * synthetic integration plugin is running and both permissions are active.
 */
export function mcpPluginAllowsTool(
  registry: PluginRegistry,
  permissions: PluginPermissionManager,
  serverId: string
): { allowed: boolean; pluginId: string; reason?: string } {
  const pluginId = mcpPluginId(serverId);
  const record = registry.getRecord(pluginId);

  if (!record) {
    return {
      allowed: false,
      pluginId,
      reason: 'The MCP server is not registered as a plugin integration.',
    };
  }

  if (record.status !== 'running') {
    return {
      allowed: false,
      pluginId,
      reason: `The MCP integration is ${record.status}.`,
    };
  }

  for (const permission of ['mcp.connect', 'ai.invoke'] as PluginPermission[]) {
    if (!permissions.has(pluginId, permission)) {
      return {
        allowed: false,
        pluginId,
        reason: `The "${permission}" permission is not granted.`,
      };
    }
  }

  return { allowed: true, pluginId };
}
