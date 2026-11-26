import {
  getMcpStatuses,
  getMcpToolCount,
  syncMcpTools,
} from '@/lib/mcp/registry';
import { loadMcpServers } from '@/lib/mcp/settings';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeHostTool,
  nativeOutputSchema,
  objectSchema,
} from './helpers';

export const MCP_PLUGIN_ID = 'orbit.builtin.mcp';

export const mcpManifest: PluginManifest = seedPluginManifest({
  pluginId: MCP_PLUGIN_ID,
  name: 'ORBIT MCP',
  version: '1.0.0',
  description:
    'Read-only inspection and approved refresh of the existing MCP tool mirror. It adds no second HTTP transport, tool gate or synthetic plugin store.',
  category: 'mcp',
  icon: 'lan-connect-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-mcp' },
  permissions: ['ai.invoke', 'mcp.connect', 'storage.read'],
  capabilities: ['tools.mcp', 'integration.mcp'],
  dependencies: [{ pluginId: 'orbit.core.mcp', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const STATUS_OUTPUT_SCHEMA = nativeOutputSchema({
  toolCount: { type: 'integer' },
  total: { type: 'integer' },
  servers: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        serverName: { type: 'string' },
        ok: { type: 'boolean' },
        toolCount: { type: 'integer' },
        error: { type: 'string' },
      },
      required: ['serverId', 'serverName', 'ok', 'toolCount', 'error'],
      additionalProperties: false,
    },
  },
});

const SERVERS_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  servers: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['id', 'name', 'enabled'],
      additionalProperties: false,
    },
  },
});

const statusTool = nativeHostTool('mcp_status', {
  name: 'mcp_status',
  description:
    'Report the existing MCP tool mirror status. Read-only; it does not reveal server URLs or tokens.',
  parameters: objectSchema({}, []),
  outputSchema: STATUS_OUTPUT_SCHEMA,
  execute() {
    const statuses = getMcpStatuses();

    return {
      toolCount: getMcpToolCount(),
      total: statuses.length,
      servers: statuses.map((status) => ({
        serverId: status.serverId,
        serverName: status.serverName,
        ok: status.ok,
        toolCount: status.toolCount,
        error: status.error ?? '',
      })),
    };
  },
});

const serversTool = nativeHostTool('mcp_servers', {
  name: 'mcp_servers',
  description:
    'List configured MCP server metadata without URLs or credentials. Read-only.',
  parameters: objectSchema({}, []),
  outputSchema: SERVERS_OUTPUT_SCHEMA,
  async execute() {
    const servers = await loadMcpServers();

    return {
      total: servers.length,
      servers: servers.map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
      })),
    };
  },
});

const syncTool = nativeHostTool('mcp_sync', {
  name: 'mcp_sync',
  description:
    'Force the existing MCP registry to re-sync tools and plugin records. The platform tool gate and revocations still apply. Requires explicit approval.',
  parameters: objectSchema({}, []),
  outputSchema: nativeOutputSchema({
    toolCount: { type: 'integer' },
    syncedAt: { type: 'integer' },
    statusCount: { type: 'integer' },
  }),
  permissions: ['mcp.connect'],
  requiresApproval: true,
  async execute() {
    const result = await syncMcpTools({ force: true });

    return {
      toolCount: result.toolCount,
      syncedAt: result.syncedAt,
      statusCount: result.statuses.length,
    };
  },
});

export const mcpImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.mcp] MCP inspection plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.mcp] MCP inspection plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.mcp] MCP inspection plugin reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(statusTool);
    void sdk.tools.register(serversTool);
    void sdk.tools.register(syncTool);
  },
};
