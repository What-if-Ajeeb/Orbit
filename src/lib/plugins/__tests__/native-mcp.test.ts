import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { MCP_PLUGIN_ID, NATIVE_PLUGIN_MANIFESTS } from '../native';
import { createNativeHarness } from './native-harness';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-native-test' }));
vi.mock('expo-linking', () => ({ openURL: vi.fn(async () => undefined) }));
vi.mock('@/lib/safety/trash', () => ({
  SafetyTrash: class {
    list(): Promise<unknown[]> {
      return Promise.resolve([]);
    }
  },
}));
vi.mock('@/lib/permissions/devices', () => ({
  listPairedDevices: vi.fn(async () => []),
}));
vi.mock('@/lib/agent-actions/service', () => ({
  AGENT_ACTION_PROJECT_ID: 'orbit-agent-actions',
}));
vi.mock('@/lib/chat', () => ({
  getChatStore: () => ({ listConversations: vi.fn(async () => []) }),
}));
vi.mock('@/lib/workflows', () => ({
  WorkflowStore: class {
    list() {
      return Promise.resolve([]);
    }
    listRuns() {
      return Promise.resolve([]);
    }
  },
}));
vi.mock('@/lib/tasks', () => ({
  listTasks: vi.fn(async () => []),
  getTaskStats: vi.fn(async () => ({
    openCount: 0,
    doneCount: 0,
    dueToday: 0,
    overdue: 0,
    nextReminderAt: null,
  })),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock('@/lib/buddy', () => ({
  listUserBuddies: vi.fn(async () => []),
  getUserBuddy: vi.fn(async () => null),
  listBuddyActivities: vi.fn(async () => []),
  getInventory: vi.fn(async () => []),
  getEvolutionBranches: vi.fn(() => []),
  canEvolveTo: vi.fn(() => ({ ok: false, missing: [] })),
  getForm: vi.fn(() => undefined),
  setActiveBuddy: vi.fn(async () => undefined),
  tryEvolve: vi.fn(async () => ({ ok: false, error: 'unavailable' })),
}));

const mocks = vi.hoisted(() => ({
  getMcpStatuses: vi.fn(),
  getMcpToolCount: vi.fn(),
  syncMcpTools: vi.fn(),
  loadMcpServers: vi.fn(),
}));

vi.mock('@/lib/mcp/registry', () => mocks);
vi.mock('@/lib/mcp/settings', () => ({ loadMcpServers: mocks.loadMcpServers }));

async function enableMcp() {
  const confirmSensitiveTool = vi.fn(async () => true);
  const harness = await createNativeHarness({ confirmSensitiveTool });
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === MCP_PLUGIN_ID
  )!;

  await harness.registry.install(MCP_PLUGIN_ID);
  await harness.permissions.grant(
    MCP_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(MCP_PLUGIN_ID);
  return { harness, confirmSensitiveTool };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

describe('ORBIT MCP native plugin', () => {
  it('reports mirror status and server metadata without secrets', async () => {
    const harness = (await enableMcp()).harness;
    mocks.getMcpStatuses.mockReturnValue([
      {
        serverId: 'srv_1',
        serverName: 'Docs',
        ok: true,
        toolCount: 3,
      },
    ]);
    mocks.getMcpToolCount.mockReturnValue(3);
    mocks.loadMcpServers.mockResolvedValue([
      {
        id: 'srv_1',
        name: 'Docs',
        url: 'https://secret-token@example.com/mcp',
        token: 'secret-token',
        enabled: true,
      },
    ]);

    const status = harness.toolHost.tools.get('plugin__orbit_builtin_mcp__mcp_status');
    const servers = harness.toolHost.tools.get('plugin__orbit_builtin_mcp__mcp_servers');

    const statusResult = JSON.parse((await status!.execute(context, {})).content);
    expect(statusResult).toMatchObject({
      ok: true,
      toolCount: 3,
      total: 1,
      servers: [{ serverId: 'srv_1', ok: true, toolCount: 3, error: '' }],
    });

    const serverResult = JSON.parse((await servers!.execute(context, {})).content);
    expect(serverResult).toMatchObject({
      ok: true,
      total: 1,
      servers: [{ id: 'srv_1', name: 'Docs', enabled: true }],
    });
    expect(JSON.stringify(serverResult)).not.toContain('secret-token');
  });

  it('forces an approved re-sync through the existing registry only', async () => {
    const { harness, confirmSensitiveTool } = await enableMcp();
    mocks.syncMcpTools.mockResolvedValue({
      statuses: [{ serverId: 'srv_1', ok: true, toolCount: 2 }],
      toolCount: 2,
      syncedAt: 99,
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_mcp__mcp_sync');
    const result = JSON.parse((await tool!.execute(context, {})).content);

    expect(result).toMatchObject({ ok: true, toolCount: 2, syncedAt: 99 });
    expect(mocks.syncMcpTools).toHaveBeenCalledWith({ force: true });
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'mcp_sync' })
    );
  });
});
