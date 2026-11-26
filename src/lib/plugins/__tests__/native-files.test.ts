import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { FILES_PLUGIN_ID, NATIVE_PLUGIN_MANIFESTS } from '../native';
import { createNativeHarness } from './native-harness';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-native-test' }));
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
  list: vi.fn(),
  get: vi.fn(),
  getVersion: vi.fn(),
  create: vi.fn(),
  addVersion: vi.fn(),
  restoreVersion: vi.fn(),
  remove: vi.fn(),
  exists: vi.fn(),
  trashList: vi.fn(),
}));

vi.mock('@/lib/artifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/artifacts')>();

  class ArtifactStore {
    constructor(private db: SQLiteDatabase) {}

    list(...args: unknown[]) {
      return mocks.list(this.db, ...args);
    }

    get(...args: unknown[]) {
      return mocks.get(this.db, ...args);
    }

    getVersion(...args: unknown[]) {
      return mocks.getVersion(this.db, ...args);
    }

    create(...args: unknown[]) {
      return mocks.create(this.db, ...args);
    }

    addVersion(...args: unknown[]) {
      return mocks.addVersion(this.db, ...args);
    }

    restoreVersion(...args: unknown[]) {
      return mocks.restoreVersion(this.db, ...args);
    }

    remove(...args: unknown[]) {
      return mocks.remove(this.db, ...args);
    }

    exists(...args: unknown[]) {
      return mocks.exists(this.db, ...args);
    }
  }

  return { ...actual, ArtifactStore };
});

vi.mock('@/lib/safety/trash', () => ({
  SafetyTrash: class {
    list = mocks.trashList;
  },
}));

async function enableFiles() {
  const confirmSensitiveTool = vi.fn(async () => true);
  const harness = await createNativeHarness({ confirmSensitiveTool });
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === FILES_PLUGIN_ID
  )!;

  await harness.registry.install(FILES_PLUGIN_ID);
  await harness.permissions.grant(
    FILES_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(FILES_PLUGIN_ID);
  return { harness, confirmSensitiveTool };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

describe('ORBIT Files native plugin', () => {
  it('lists and reads user-scoped artifacts with bounded content', async () => {
    const { harness } = await enableFiles();
    mocks.list.mockResolvedValue([
      {
        id: 'art_1',
        userId: 7,
        conversationId: 3,
        title: 'Plan',
        type: 'markdown',
        language: null,
        currentVersion: 2,
        createdAt: 10,
        updatedAt: 20,
      },
    ]);
    mocks.get.mockResolvedValue({
      id: 'art_1',
      userId: 7,
      conversationId: 3,
      title: 'Plan',
      type: 'markdown',
      language: null,
      currentVersion: 2,
      content: 'hello',
      createdAt: 10,
      updatedAt: 20,
      versions: [],
    });

    const list = harness.toolHost.tools.get(
      'plugin__orbit_builtin_files__files_list'
    );
    const read = harness.toolHost.tools.get(
      'plugin__orbit_builtin_files__files_read'
    );
    expect(list).toBeDefined();
    expect(read).toBeDefined();

    const listed = await list!.execute(context, { limit: 10 });
    expect(JSON.parse(listed.content)).toMatchObject({
      ok: true,
      total: 1,
      files: [{ id: 'art_1', title: 'Plan', version: 2 }],
    });
    expect(mocks.list).toHaveBeenCalledWith(context.db, 7, 10);

    const readResult = await read!.execute(context, { id: 'art_1' });
    expect(JSON.parse(readResult.content)).toMatchObject({
      ok: true,
      id: 'art_1',
      version: 2,
      content: 'hello',
      truncated: false,
    });
  });

  it('creates, versions and removes artifacts with explicit approval', async () => {
    const { harness, confirmSensitiveTool } = await enableFiles();
    const artifact = {
      id: 'art_2',
      userId: 7,
      conversationId: undefined,
      title: 'Script',
      type: 'code',
      language: 'typescript',
      currentVersion: 2,
      content: 'export {};',
      createdAt: 10,
      updatedAt: 30,
    };
    mocks.create.mockResolvedValue({ ...artifact, currentVersion: 1, updatedAt: 20 });
    mocks.addVersion.mockResolvedValue(artifact);
    mocks.exists.mockResolvedValue(true);
    mocks.remove.mockResolvedValue(undefined);

    const create = harness.toolHost.tools.get(
      'plugin__orbit_builtin_files__files_create'
    );
    const write = harness.toolHost.tools.get(
      'plugin__orbit_builtin_files__files_write'
    );
    const remove = harness.toolHost.tools.get(
      'plugin__orbit_builtin_files__files_remove'
    );

    const created = await create!.execute(context, {
      title: 'Script',
      type: 'code',
      language: 'typescript',
      content: '  export {};  ',
    });
    expect(JSON.parse(created.content)).toMatchObject({ ok: true, id: 'art_2' });
    expect(mocks.create.mock.calls[0][2].content).toBe('  export {};  ');
    expect(mocks.create.mock.calls[0][2].conversationId).toBeUndefined();

    const written = await write!.execute(context, {
      id: 'art_2',
      content: 'export const x = 1;',
      summary: 'add x',
    });
    expect(JSON.parse(written.content)).toMatchObject({ ok: true, version: 2 });
    expect(mocks.addVersion).toHaveBeenCalledWith(
      context.db,
      7,
      'art_2',
      'export const x = 1;',
      'add x'
    );

    const removed = await remove!.execute(context, { id: 'art_2' });
    expect(JSON.parse(removed.content)).toMatchObject({ ok: true, removed: true });
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'files_create' })
    );
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'files_write' })
    );
    expect(confirmSensitiveTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'files_remove' })
    );
  });

  it('returns only safety-trash metadata, never stored paths', async () => {
    const { harness } = await enableFiles();
    mocks.trashList.mockResolvedValue([
      {
        id: 'trash_1',
        userId: 7,
        conversationId: null,
        agentId: 'master',
        toolName: 'file_trash',
        originalPath: '/private/var/mobile/secret.txt',
        storedPath: '/private/var/mobile/orbit-safety/trash/secret.txt',
        kind: 'file',
        name: 'secret.txt',
        size: 12,
        mimeType: 'text/plain',
        metadata: {},
        deletedAt: 1,
        expiresAt: 2,
        restoredAt: null,
        purgedAt: null,
        status: 'trashed',
        failureReason: null,
      },
    ]);

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_files__files_trash_list'
    );
    const result = await tool!.execute(context, {});
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      total: 1,
      items: [{ id: 'trash_1', name: 'secret.txt', status: 'trashed' }],
    });
    expect(parsed.items[0]).not.toHaveProperty('storedPath');
    expect(parsed.items[0]).not.toHaveProperty('originalPath');
  });
});
