import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { CODE_PLUGIN_ID, NATIVE_PLUGIN_MANIFESTS } from '../native';
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

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  getVersion: vi.fn(),
  listPairedDevices: vi.fn(),
}));

vi.mock('@/lib/artifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/artifacts')>();

  class ArtifactStore {
    constructor(private db: SQLiteDatabase) {}

    create(...args: unknown[]) {
      return mocks.create(this.db, ...args);
    }

    get(...args: unknown[]) {
      return mocks.get(this.db, ...args);
    }

    getVersion(...args: unknown[]) {
      return mocks.getVersion(this.db, ...args);
    }
  }

  return { ...actual, ArtifactStore };
});

vi.mock('@/lib/permissions/devices', () => ({
  listPairedDevices: mocks.listPairedDevices,
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

async function enableCode() {
  const confirmSensitiveTool = vi.fn(async () => true);
  const harness = await createNativeHarness({ confirmSensitiveTool });
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === CODE_PLUGIN_ID
  )!;

  await harness.registry.install(CODE_PLUGIN_ID);
  await harness.permissions.grant(
    CODE_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(CODE_PLUGIN_ID);
  return { harness, confirmSensitiveTool };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

describe('ORBIT Code native plugin', () => {
  it('saves and reads code artifacts without executing them', async () => {
    const { harness, confirmSensitiveTool } = await enableCode();
    mocks.create.mockResolvedValue({
      id: 'art_code',
      currentVersion: 1,
      updatedAt: 20,
    });
    mocks.get.mockResolvedValue({
      id: 'art_code',
      userId: 7,
      title: 'Helper',
      type: 'code',
      language: 'typescript',
      currentVersion: 1,
      content: 'export const x = 1;',
    });

    const save = harness.toolHost.tools.get(
      'plugin__orbit_builtin_code__code_artifact_save'
    );
    const read = harness.toolHost.tools.get(
      'plugin__orbit_builtin_code__code_artifact_read'
    );
    expect(save).toBeDefined();
    expect(read).toBeDefined();

    const saved = await save!.execute(context, {
      title: 'Helper',
      language: 'typescript',
      content: 'export const x = 1;',
    });
    expect(JSON.parse(saved.content)).toMatchObject({
      ok: true,
      id: 'art_code',
    });
    expect(mocks.create.mock.calls[0][2]).toMatchObject({
      type: 'code',
      language: 'typescript',
      content: 'export const x = 1;',
    });
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'code_artifact_save' })
    );

    const readResult = await read!.execute(context, { id: 'art_code' });
    expect(JSON.parse(readResult.content)).toMatchObject({
      ok: true,
      language: 'typescript',
      content: 'export const x = 1;',
    });
  });

  it('lists paired companions without exposing endpoints or executing commands', async () => {
    const { harness } = await enableCode();
    mocks.listPairedDevices.mockResolvedValue([
      {
        id: 'dev_1',
        userId: 7,
        name: 'Desk',
        platform: 'android',
        endpoint: 'https://secret-endpoint',
        fingerprint: 'secret-fingerprint',
        status: 'paired',
        capabilities: ['shell'],
        pairedAt: 1,
        lastSeenAt: 2,
      },
    ]);

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_code__code_paired_devices'
    );
    const result = await tool!.execute(context, {});
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      total: 1,
      devices: [{ id: 'dev_1', name: 'Desk', status: 'paired' }],
    });
    expect(parsed.devices[0]).not.toHaveProperty('endpoint');
    expect(parsed.devices[0]).not.toHaveProperty('fingerprint');
    expect(harness.toolHost.has('plugin__orbit_builtin_code__code_execute')).toBe(false);
  });
});
