import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { NATIVE_PLUGIN_MANIFESTS, SANDBOX_PLUGIN_ID } from '../native';
import { createNativeHarness } from './native-harness';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-native-test' }));
vi.mock('@/lib/safety/trash', () => ({
  SafetyTrash: class {
    list(): Promise<unknown[]> {
      return Promise.resolve([]);
    }
  },
}));
vi.mock('expo-linking', () => ({ openURL: vi.fn(async () => undefined) }));
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

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getSnapshot: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@/lib/sandbox/manager', () => ({
  getMobileSandboxManager: () => ({
    initialize: mocks.initialize,
    getSnapshot: mocks.getSnapshot,
    execute: mocks.execute,
  }),
}));

async function enableSandbox() {
  const confirmSensitiveTool = vi.fn(async () => true);
  const harness = await createNativeHarness({ confirmSensitiveTool });
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === SANDBOX_PLUGIN_ID
  )!;

  await harness.registry.install(SANDBOX_PLUGIN_ID);
  await harness.permissions.grant(
    SANDBOX_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(SANDBOX_PLUGIN_ID);
  return { harness, confirmSensitiveTool };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

describe('ORBIT Sandbox native plugin', () => {
  it('is Android-only and declares the existing execution permission', () => {
    const manifest = NATIVE_PLUGIN_MANIFESTS.find(
      (entry) => entry.pluginId === SANDBOX_PLUGIN_ID
    )!;

    expect(manifest.platformSupport).toEqual(['android']);
    expect(manifest.permissions).toEqual(['ai.invoke', 'sandbox.execute']);
  });

  it('exposes sandbox policy from the existing manager without executing', async () => {
    const { harness } = await enableSandbox();
    mocks.initialize.mockResolvedValue({
      coreVersion: '0.1.0',
      policyVersion: 1,
      isolation: 'android-isolated-process',
      executionFormat: 'deterministic-json-program',
      allowedOperations: ['add', 'concat', 'return'],
      limits: { maxInstructions: 256, maxOutputBytes: 16_384, maxValueBytes: 8_192 },
    });
    mocks.getSnapshot.mockReturnValue({ sessions: [], busy: 0 });
    mocks.execute.mockClear();

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_policy'
    );
    const result = JSON.parse((await tool!.execute(context, {})).content);

    expect(result).toMatchObject({
      ok: true,
      policyVersion: 1,
      isolation: 'android-isolated-process',
      sessionCount: 0,
      busy: 0,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('runs only reviewed data-only programs with explicit approval', async () => {
    const { harness, confirmSensitiveTool } = await enableSandbox();
    mocks.execute.mockResolvedValue({
      ok: true,
      outputs: { result: 9 },
      instructionsExecuted: 5,
      errors: [],
      policyVersion: 1,
    });

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_compute'
    );
    const result = JSON.parse(
      (await tool!.execute(context, { operation: 'add', left: 4, right: 5 })).content
    );

    expect(result).toMatchObject({
      ok: true,
      operation: 'add',
      outputs: { result: 9 },
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        pluginId: SANDBOX_PLUGIN_ID,
        version: '1.0.0',
        program: {
          version: 1,
          instructions: [
            { op: 'load', key: 'input', field: 'left' },
            { op: 'load', key: 'input', field: 'right' },
            { op: 'add' },
            { op: 'emit', key: 'result' },
            { op: 'return' },
          ],
        },
      },
      { left: 4, right: 5 }
    );
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'sandbox_compute' })
    );
  });

  it('rejects raw instructions and fails closed when the bridge is unavailable', async () => {
    const { harness } = await enableSandbox();
    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_compute'
    )!;

    const raw = await tool.execute(context, {
      operation: 'echo',
      value: 'x',
      instructions: [{ op: 'push', value: 1 }],
    });
    expect(JSON.parse(raw.content)).toMatchObject({ ok: false });

    mocks.execute.mockRejectedValueOnce(
      new Error('The ORBIT mobile sandbox is only available on Android.')
    );
    const unavailable = await tool.execute(context, {
      operation: 'echo',
      value: 'x',
    });
    expect(JSON.parse(unavailable.content)).toMatchObject({ ok: false });
  });
});
