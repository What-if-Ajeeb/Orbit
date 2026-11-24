import { describe, expect, it } from 'vitest';

import { isReservedPluginId } from '../manifest';
import {
  buildMcpPluginManifest,
  isMcpPluginId,
  mcpPluginAllowsTool,
  mcpPluginId,
  MCP_PLUGIN_PREFIX,
  syncMcpPluginRecords,
} from '../mcp-bridge';
import { createHarness, mcpServer } from './helpers';

describe('MCP plugin bridge', () => {
  it('derives synthetic ids from the exported prefix', () => {
    expect(MCP_PLUGIN_PREFIX).toBe('mcp.server.');
    expect(mcpPluginId('Alpha_Server 42')).toBe(`${MCP_PLUGIN_PREFIX}alpha-server-42`);
    expect(mcpPluginId('---')).toBe(`${MCP_PLUGIN_PREFIX}server`);
    expect(mcpPluginId('a'.repeat(80))).toHaveLength(MCP_PLUGIN_PREFIX.length + 40);
    expect(isMcpPluginId(mcpPluginId('alpha'))).toBe(true);
    expect(isMcpPluginId('ordinary.plugin')).toBe(false);
    expect(isReservedPluginId(mcpPluginId('alpha'))).toBe(false);
  });

  it('builds a synthetic manifest without exposing the server token', () => {
    const server = mcpServer();
    const manifest = buildMcpPluginManifest(server);

    expect(manifest.pluginId).toBe(mcpPluginId(server.id));
    expect(manifest.entryPoint).toEqual({ kind: 'mcp', serverId: server.id });
    expect(manifest.permissions).toEqual(['mcp.connect', 'ai.invoke']);
    expect(manifest.capabilities).toEqual(['integration.mcp', 'tools.mcp']);
    expect(manifest.description).toContain('https://…/mcp');
    expect(manifest.description).not.toContain(server.token);
    expect(JSON.stringify(manifest)).not.toContain(server.token);
  });

  it('grants consent on first sight and runs an enabled server', async () => {
    const { registry, permissions, persistence } = createHarness({});
    const server = mcpServer();
    const pluginId = mcpPluginId(server.id);

    const result = await syncMcpPluginRecords({
      registry,
      permissions,
      servers: [server],
    });

    expect(result).toEqual({ connected: [pluginId], blocked: [] });
    expect(registry.getRecord(pluginId)).toMatchObject({
      status: 'running',
      enabled: true,
      trustLevel: 'local',
      source: 'local',
    });
    expect(permissions.activeGrants(pluginId)).toEqual(['ai.invoke', 'mcp.connect']);
    const grant = await persistence.loadPermissions();
    expect(grant.every((row) => row.source === 'mcp_settings')).toBe(true);
    expect((await permissions.audit(pluginId))[0]).toMatchObject({
      event: 'permissions_granted',
      source: 'mcp_settings',
    });
  });

  it('does not re-grant revoked permissions and blocks the integration', async () => {
    const { registry, permissions } = createHarness({});
    const server = mcpServer();
    const pluginId = mcpPluginId(server.id);

    await syncMcpPluginRecords({ registry, permissions, servers: [server] });
    await permissions.revoke(pluginId, 'mcp.connect', 'User revoked MCP access.');
    await permissions.revoke(pluginId, 'ai.invoke', 'User revoked tool access.');

    const result = await syncMcpPluginRecords({
      registry,
      permissions,
      servers: [server],
    });

    expect(result).toEqual({ connected: [], blocked: [pluginId] });
    expect(registry.getRecord(pluginId)).toMatchObject({
      status: 'disabled',
      enabled: false,
      error: /required permission was revoked/,
    });
    expect(permissions.activeGrants(pluginId)).toEqual([]);
    expect(permissions.getRecord(pluginId, 'mcp.connect')).toMatchObject({
      granted: false,
      source: 'mcp_settings',
    });
    expect(mcpPluginAllowsTool(registry, permissions, server.id).allowed).toBe(false);
  });

  it('blocks disabled and blank-url servers and disables removed running servers', async () => {
    const { registry, permissions } = createHarness({});
    const alpha = mcpServer();
    const beta = mcpServer({ id: 'beta-server', name: 'Beta', enabled: false });
    const gamma = mcpServer({ id: 'gamma-server', name: 'Gamma' });

    const first = await syncMcpPluginRecords({
      registry,
      permissions,
      servers: [alpha, beta, gamma],
    });
    expect(first.connected).toEqual([mcpPluginId(alpha.id), mcpPluginId(gamma.id)]);
    expect(first.blocked).toEqual([mcpPluginId(beta.id)]);
    expect(registry.getRecord(mcpPluginId(beta.id))?.status).toBe('disabled');

    const second = await syncMcpPluginRecords({
      registry,
      permissions,
      servers: [alpha],
    });
    expect(second.blocked).toEqual([]);
    expect(registry.getRecord(mcpPluginId(gamma.id))).toMatchObject({
      status: 'disabled',
      enabled: false,
    });
    expect(registry.getRecord(mcpPluginId(alpha.id))?.status).toBe('running');

    const blankUrl = mcpServer({ id: 'blank', url: '' });
    const third = await syncMcpPluginRecords({
      registry,
      permissions,
      servers: [blankUrl],
    });
    expect(third.blocked).toEqual([mcpPluginId(blankUrl.id)]);
    expect(registry.getRecord(mcpPluginId(blankUrl.id))?.status).toBe('disabled');
    expect(registry.getRecord(mcpPluginId(alpha.id))?.status).toBe('disabled');
  });

  it('gates MCP tools on running status and both active permissions', async () => {
    const { registry, permissions } = createHarness({});
    const server = mcpServer();
    const pluginId = mcpPluginId(server.id);

    expect(mcpPluginAllowsTool(registry, permissions, server.id)).toMatchObject({
      allowed: false,
      pluginId,
      reason: /not registered/,
    });

    await syncMcpPluginRecords({ registry, permissions, servers: [server] });
    expect(mcpPluginAllowsTool(registry, permissions, server.id)).toEqual({
      allowed: true,
      pluginId,
    });

    await permissions.revoke(pluginId, 'ai.invoke', 'Revoked for test.');
    expect(mcpPluginAllowsTool(registry, permissions, server.id)).toMatchObject({
      allowed: false,
      reason: /"ai.invoke" permission is not granted/,
    });

    await registry.adopt(buildMcpPluginManifest(server), {
      trustLevel: 'local',
      source: 'local',
      status: 'disabled',
      enabled: false,
    });
    expect(mcpPluginAllowsTool(registry, permissions, server.id)).toMatchObject({
      allowed: false,
      reason: /integration is disabled/,
    });
  });
});
