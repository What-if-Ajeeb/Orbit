import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { NATIVE_PLUGIN_MANIFESTS, TASKS_PLUGIN_ID } from '../native';
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
  listTasks: vi.fn(),
  getTaskStats: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock('@/lib/tasks', () => mocks);

async function enableTasks() {
  const confirmSensitiveTool = vi.fn(async () => true);
  const harness = await createNativeHarness({ confirmSensitiveTool });
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === TASKS_PLUGIN_ID
  )!;

  await harness.registry.install(TASKS_PLUGIN_ID);
  await harness.permissions.grant(
    TASKS_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(TASKS_PLUGIN_ID);
  return { harness, confirmSensitiveTool };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

const task = {
  id: 12,
  userId: 7,
  title: 'Ship report',
  notes: null,
  dueAt: null,
  remindAt: null,
  priority: 'high',
  status: 'open',
  notificationId: null,
  createdAt: 1,
  updatedAt: 2,
  completedAt: null,
};

describe('ORBIT Tasks native plugin', () => {
  it('lists and summarizes tasks through the existing task store', async () => {
    const { harness } = await enableTasks();
    mocks.listTasks.mockResolvedValue([task]);
    mocks.getTaskStats.mockResolvedValue({
      openCount: 1,
      doneCount: 0,
      dueToday: 0,
      overdue: 0,
      nextReminderAt: null,
    });

    const list = harness.toolHost.tools.get(
      'plugin__orbit_builtin_tasks__tasks_list'
    );
    const stats = harness.toolHost.tools.get(
      'plugin__orbit_builtin_tasks__tasks_stats'
    );

    const listed = await list!.execute(context, { status: 'open', limit: 10 });
    expect(JSON.parse(listed.content)).toMatchObject({
      ok: true,
      total: 1,
      tasks: [{ id: 12, title: 'Ship report', notes: null }],
    });
    expect(mocks.listTasks).toHaveBeenCalledWith(context.db, 7, {
      status: 'open',
      limit: 10,
    });

    const summarized = await stats!.execute(context, {});
    expect(JSON.parse(summarized.content)).toMatchObject({
      ok: true,
      openCount: 1,
      doneCount: 0,
    });
  });

  it('creates and completes tasks with approval, delegating reminders and rewards', async () => {
    const { harness, confirmSensitiveTool } = await enableTasks();
    mocks.createTask.mockResolvedValue(task);
    mocks.completeTask.mockResolvedValue({ ...task, status: 'done', completedAt: 3 });

    const create = harness.toolHost.tools.get(
      'plugin__orbit_builtin_tasks__tasks_create'
    );
    const complete = harness.toolHost.tools.get(
      'plugin__orbit_builtin_tasks__tasks_complete'
    );

    const created = await create!.execute(context, {
      title: 'Ship report',
      priority: 'high',
    });
    expect(JSON.parse(created.content)).toMatchObject({ ok: true, id: 12 });
    expect(mocks.createTask).toHaveBeenCalledWith(context.db, 7, {
      title: 'Ship report',
      notes: undefined,
      dueAt: undefined,
      remindAt: undefined,
      priority: 'high',
    });

    const completed = await complete!.execute(context, { id: 12 });
    expect(JSON.parse(completed.content)).toMatchObject({
      ok: true,
      status: 'done',
      completedAt: 3,
    });
    expect(mocks.completeTask).toHaveBeenCalledWith(context.db, 7, 12);
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'tasks_create' })
    );
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'tasks_complete' })
    );
  });
});
