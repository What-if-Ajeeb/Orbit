import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { BUDDY_PLUGIN_ID, NATIVE_PLUGIN_MANIFESTS } from '../native';
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
vi.mock('@/lib/mcp/registry', () => ({
  getMcpStatuses: vi.fn(() => []),
  getMcpToolCount: vi.fn(() => 0),
  syncMcpTools: vi.fn(async () => ({ statuses: [], toolCount: 0, syncedAt: 0 })),
}));
vi.mock('@/lib/mcp/settings', () => ({
  loadMcpServers: vi.fn(async () => []),
}));

const mocks = vi.hoisted(() => ({
  listUserBuddies: vi.fn(),
  getUserBuddy: vi.fn(),
  listBuddyActivities: vi.fn(),
  getInventory: vi.fn(),
  getEvolutionBranches: vi.fn(),
  canEvolveTo: vi.fn(),
  getForm: vi.fn(),
  setActiveBuddy: vi.fn(),
  tryEvolve: vi.fn(),
}));

vi.mock('@/lib/buddy', () => mocks);

async function enableBuddy() {
  const confirmSensitiveTool = vi.fn(async () => true);
  const harness = await createNativeHarness({ confirmSensitiveTool });
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === BUDDY_PLUGIN_ID
  )!;

  await harness.registry.install(BUDDY_PLUGIN_ID);
  await harness.permissions.grant(
    BUDDY_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(BUDDY_PLUGIN_ID);
  return { harness, confirmSensitiveTool };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

const buddy = {
  id: 'buddy_1',
  userId: 7,
  speciesId: 'spark',
  nickname: null,
  currentFormId: 'spark_form_1',
  level: 4,
  xp: 500,
  bond: 60,
  isActive: true,
  mood: 'happy',
  unlockedForms: ['spark_form_1'],
  createdAt: 1,
  updatedAt: 2,
  lastInteractedAt: 3,
};

const form = {
  id: 'spark_form_2',
  speciesId: 'spark',
  name: 'Sparkling',
  stage: 2,
  rarity: 'rare',
  element: 'fire',
  description: 'A brighter spark.',
  stats: { attack: 2, defense: 2, speed: 2 },
  imageKey: 'spark_form_2',
};

describe('ORBIT Buddy native plugin', () => {
  it('reads buddies, inventory and evolution options from the existing store', async () => {
    const harness = (await enableBuddy()).harness;
    mocks.listUserBuddies.mockResolvedValue([buddy]);
    mocks.getUserBuddy.mockResolvedValue(buddy);
    mocks.getInventory.mockResolvedValue([{ itemId: 'stone', quantity: 2 }]);
    mocks.getEvolutionBranches.mockReturnValue([form]);
    mocks.canEvolveTo.mockReturnValue({ ok: true, missing: [] });
    mocks.listBuddyActivities.mockResolvedValue([
      { id: 1, activity: 'task_complete', xpGained: 25, bondGained: 3, createdAt: 2 },
    ]);

    const list = harness.toolHost.tools.get('plugin__orbit_builtin_buddy__buddy_list');
    const inventory = harness.toolHost.tools.get(
      'plugin__orbit_builtin_buddy__buddy_inventory'
    );
    const options = harness.toolHost.tools.get(
      'plugin__orbit_builtin_buddy__buddy_evolution_options'
    );
    const activities = harness.toolHost.tools.get(
      'plugin__orbit_builtin_buddy__buddy_activities'
    );

    const listed = JSON.parse((await list!.execute(context, {})).content);
    expect(listed).toMatchObject({
      ok: true,
      total: 1,
      buddies: [{ id: 'buddy_1', level: 4, bond: 60 }],
    });

    const inv = JSON.parse((await inventory!.execute(context, {})).content);
    expect(inv).toMatchObject({
      ok: true,
      items: [{ itemId: 'stone', quantity: 2 }],
    });

    const evolved = JSON.parse(
      (await options!.execute(context, { buddyId: 'buddy_1' })).content
    );
    expect(evolved).toMatchObject({
      ok: true,
      options: [{ id: 'spark_form_2', allowed: true, missing: [] }],
    });

    const activityResult = JSON.parse(
      (await activities!.execute(context, { buddyId: 'buddy_1' })).content
    );
    expect(activityResult).toMatchObject({
      ok: true,
      activities: [{ id: 1, activity: 'task_complete' }],
    });
  });

  it('evolves only through the existing store with explicit approval', async () => {
    const { harness, confirmSensitiveTool } = await enableBuddy();
    mocks.getUserBuddy.mockResolvedValue(buddy);
    mocks.tryEvolve.mockResolvedValue({
      ok: true,
      evolved: true,
      from: { id: 'spark_form_1' },
      to: form,
      buddy,
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_buddy__buddy_evolve');
    const result = JSON.parse(
      (await tool!.execute(context, {
        buddyId: 'buddy_1',
        targetFormId: 'spark_form_2',
      })).content
    );

    expect(result).toMatchObject({
      ok: true,
      evolved: true,
      fromFormId: 'spark_form_1',
      toFormId: 'spark_form_2',
      buddy: { id: 'buddy_1' },
    });
    expect(mocks.tryEvolve).toHaveBeenCalledWith(
      context.db,
      7,
      'buddy_1',
      'spark_form_2'
    );
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'buddy_evolve' })
    );
  });
});
