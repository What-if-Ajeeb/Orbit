import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { BROWSER_PLUGIN_ID, NATIVE_PLUGIN_MANIFESTS } from '../native';
import { createNativeHarness } from './native-harness';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-native-test' }));
vi.mock('@/lib/safety/trash', () => ({
  SafetyTrash: class {
    list(): Promise<unknown[]> {
      return Promise.resolve([]);
    }
  },
}));

const mocks = vi.hoisted(() => ({ openURL: vi.fn(async () => undefined) }));
vi.mock('expo-linking', () => ({ openURL: mocks.openURL }));
vi.mock('@/lib/permissions/devices', () => ({
  listPairedDevices: vi.fn(async () => []),
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
vi.mock('@/lib/mcp/registry', () => ({
  getMcpStatuses: vi.fn(() => []),
  getMcpToolCount: vi.fn(() => 0),
  syncMcpTools: vi.fn(async () => ({ statuses: [], toolCount: 0, syncedAt: 0 })),
}));
vi.mock('@/lib/mcp/settings', () => ({
  loadMcpServers: vi.fn(async () => []),
}));

async function enableBrowser() {
  const confirmSensitiveTool = vi.fn(async () => true);
  const harness = await createNativeHarness({ confirmSensitiveTool });
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === BROWSER_PLUGIN_ID
  )!;

  await harness.registry.install(BROWSER_PLUGIN_ID);
  await harness.permissions.grant(
    BROWSER_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(BROWSER_PLUGIN_ID);
  return { harness, confirmSensitiveTool };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

describe('ORBIT Browser native plugin', () => {
  it('hands approved http(s) links to the OS with explicit approval', async () => {
    const { harness, confirmSensitiveTool } = await enableBrowser();
    mocks.openURL.mockClear();
    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_browser__browser_open_link'
    );
    expect(tool).toBeDefined();

    const result = await tool!.execute(context, {
      url: 'https://example.com/docs?x=1',
    });
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      scheme: 'https',
      opened: true,
    });
    expect(mocks.openURL).toHaveBeenCalledWith('https://example.com/docs?x=1');
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'browser_open_link' })
    );
  });

  it('rejects unsafe schemes and embedded credentials without opening anything', async () => {
    const { harness } = await enableBrowser();
    mocks.openURL.mockClear();
    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_browser__browser_open_link'
    )!;

    const script = await tool.execute(context, { url: 'javascript:alert(1)' });
    const credentials = await tool.execute(context, {
      url: 'https://user:pass@example.com',
    });

    expect(JSON.parse(script.content)).toMatchObject({ ok: false });
    expect(JSON.parse(credentials.content)).toMatchObject({ ok: false });
    expect(mocks.openURL).not.toHaveBeenCalled();
  });
});
