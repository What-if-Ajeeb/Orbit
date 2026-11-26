import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import {
  CORE_PLUGIN_MANIFESTS,
  DIAGNOSTICS_MANIFEST,
} from '../builtins';
import { validateManifest } from '../manifest';
import {
  AGENT_PLUGIN_ID,
  MEMORY_PLUGIN_ID,
  NATIVE_PLUGIN_DEFINITIONS,
  NATIVE_PLUGIN_MANIFESTS,
} from '../native';
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

describe('bundled plugin manifests', () => {
  it('validates every shipped manifest with the canonical validator', () => {
    for (const manifest of [
      ...CORE_PLUGIN_MANIFESTS,
      DIAGNOSTICS_MANIFEST,
      ...NATIVE_PLUGIN_MANIFESTS,
    ]) {
      const result = validateManifest(manifest);
      const detail = result.ok ? '' : `: ${result.errors.join('; ')}`;
      expect(result.ok, `${manifest.pluginId}${detail}`).toBe(true);
    }
  });

  it('keeps native plugin ids unique, reserved and official', () => {
    const ids = NATIVE_PLUGIN_MANIFESTS.map((manifest) => manifest.pluginId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const manifest of NATIVE_PLUGIN_MANIFESTS) {
      expect(manifest.pluginId.startsWith('orbit.builtin.')).toBe(true);
      expect(manifest.manifestVersion).toBe(1);
      expect(manifest.entryPoint.kind).toBe('builtin');
      expect(manifest.publisher.verified).toBe(true);
    }
  });
});

describe('ORBIT Agent native plugin', () => {
  it('declares least-privilege permissions and core dependencies', () => {
    const manifest = NATIVE_PLUGIN_MANIFESTS.find(
      (entry) => entry.pluginId === AGENT_PLUGIN_ID
    );

    expect(manifest).toBeDefined();
    expect(manifest?.permissions).toEqual(['ai.invoke']);
    expect(manifest?.capabilities).toEqual(expect.arrayContaining(['ai.context', 'tools.ai']));
    expect(manifest?.dependencies.map((dependency) => dependency.pluginId)).toEqual(
      expect.arrayContaining([
        'orbit.core.session',
        'orbit.core.tools',
        'orbit.core.llm',
      ])
    );
    expect(manifest?.lifecycleHooks).toEqual(
      expect.arrayContaining(['onStart', 'onStop', 'onError'])
    );
  });

  it('registers read-only tools through the canonical registry', async () => {
    const harness = await createNativeHarness();

    await harness.registry.install(AGENT_PLUGIN_ID);
    await harness.permissions.grant(AGENT_PLUGIN_ID, ['ai.invoke'], 'core', 'test');
    const record = await harness.registry.enable(AGENT_PLUGIN_ID);

    expect(record.status).toBe('running');
    expect(harness.toolHost.has('plugin__orbit_builtin_agent__agent_status')).toBe(true);
    expect(harness.toolHost.has('plugin__orbit_builtin_agent__agent_list_tools')).toBe(true);

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_agent__agent_status');
    expect(tool).toBeDefined();
    const result = await tool!.execute({ db: {} as never, userId: 1 }, {});
    expect(JSON.parse(result.content)).toMatchObject({ ok: true });

    await harness.registry.disable(AGENT_PLUGIN_ID);
    expect(harness.toolHost.has('plugin__orbit_builtin_agent__agent_status')).toBe(false);
  });

  it('pairs every native manifest with reviewed code', () => {
    expect(NATIVE_PLUGIN_DEFINITIONS.length).toBeGreaterThan(0);

    for (const definition of NATIVE_PLUGIN_DEFINITIONS) {
      expect(definition.manifest.entryPoint.kind).toBe('builtin');
      expect(typeof definition.implementation.activate).toBe('function');
    }
  });
});

function fakeAgentConfigDb(): SQLiteDatabase {
  let row: Record<string, unknown> | null = null;

  return {
    getFirstAsync: vi.fn(async () => row),
    runAsync: vi.fn(
      async (
        _sql: string,
        userId: number,
        agentId: string,
        instructions: string,
        memory: string,
        toolAccessMode: string,
        allowedTools: string,
        createdAt: number,
        updatedAt: number
      ) => {
        row = {
          user_id: userId,
          agent_id: agentId,
          instructions,
          memory,
          tool_access_mode: toolAccessMode,
          allowed_tools: allowedTools,
          created_at: createdAt,
          updated_at: updatedAt,
        };
      }
    ),
  } as unknown as SQLiteDatabase;
}

describe('ORBIT Memory native plugin', () => {
  it('reads and writes scoped memory with explicit write approval', async () => {
    const confirmSensitiveTool = vi.fn(async () => true);
    const harness = await createNativeHarness({ confirmSensitiveTool });

    await harness.registry.install(MEMORY_PLUGIN_ID);
    await harness.permissions.grant(
      MEMORY_PLUGIN_ID,
      ['ai.invoke', 'storage.read', 'storage.write'],
      'core',
      'test'
    );
    const record = await harness.registry.enable(MEMORY_PLUGIN_ID);
    expect(record.status).toBe('running');

    const db = fakeAgentConfigDb();
    const context = { db, userId: 7 };
    const read = harness.toolHost.tools.get(
      'plugin__orbit_builtin_memory__memory_read'
    );
    const write = harness.toolHost.tools.get(
      'plugin__orbit_builtin_memory__memory_write'
    );
    expect(read).toBeDefined();
    expect(write).toBeDefined();

    const before = await read!.execute(context, {});
    expect(JSON.parse(before.content)).toMatchObject({
      ok: true,
      agentId: 'master',
      memory: '',
    });

    const saved = await write!.execute(context, {
      memory: 'Prefer concise answers.',
    });
    expect(JSON.parse(saved.content)).toMatchObject({
      ok: true,
      memory: 'Prefer concise answers.',
    });
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'memory_write' })
    );

    const after = await read!.execute(context, {});
    expect(JSON.parse(after.content)).toMatchObject({
      ok: true,
      memory: 'Prefer concise answers.',
    });
  });

  it('refuses to persist secret-looking memory values', async () => {
    const harness = await createNativeHarness({
      confirmSensitiveTool: vi.fn(async () => true),
    });
    await harness.registry.install(MEMORY_PLUGIN_ID);
    await harness.permissions.grant(
      MEMORY_PLUGIN_ID,
      ['ai.invoke', 'storage.read', 'storage.write'],
      'core',
      'test'
    );
    await harness.registry.enable(MEMORY_PLUGIN_ID);

    const write = harness.toolHost.tools.get(
      'plugin__orbit_builtin_memory__memory_write'
    );
    const result = await write!.execute(
      { db: fakeAgentConfigDb(), userId: 7 },
      { memory: 'api_key=super-secret-value' }
    );
    expect(JSON.parse(result.content)).toMatchObject({ ok: false });
  });
});
