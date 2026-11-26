import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { NATIVE_PLUGIN_MANIFESTS, PROJECTS_PLUGIN_ID } from '../native';
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

const mocks = vi.hoisted(() => ({
  listConversations: vi.fn(),
  listTasks: vi.fn(),
  listArtifacts: vi.fn(),
  listWorkflows: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock('@/lib/agent-actions/service', () => ({
  AGENT_ACTION_PROJECT_ID: 'orbit-agent-actions',
}));
vi.mock('@/lib/chat', () => ({
  getChatStore: () => ({ listConversations: mocks.listConversations }),
}));
vi.mock('@/lib/tasks', () => ({ listTasks: mocks.listTasks }));
vi.mock('@/lib/artifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/artifacts')>();

  class ArtifactStore {
    constructor(private db: SQLiteDatabase) {}

    list(...args: unknown[]) {
      return mocks.listArtifacts(this.db, ...args);
    }
  }

  return { ...actual, ArtifactStore };
});
vi.mock('@/lib/workflows', () => ({
  WorkflowStore: class {
    list() {
      return mocks.listWorkflows();
    }
    listRuns(...args: unknown[]) {
      return mocks.listRuns(...args);
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

async function enableProjects() {
  const harness = await createNativeHarness();
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === PROJECTS_PLUGIN_ID
  )!;

  await harness.registry.install(PROJECTS_PLUGIN_ID);
  await harness.permissions.grant(
    PROJECTS_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(PROJECTS_PLUGIN_ID);
  return harness;
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

describe('ORBIT Projects native plugin', () => {
  it('summarizes the workspace from real stores', async () => {
    const harness = await enableProjects();
    mocks.listConversations.mockResolvedValue([
      { id: 1, title: 'Chat', updatedAt: 10 },
    ]);
    mocks.listTasks.mockResolvedValue([
      { id: 2, title: 'Task', status: 'open' },
    ]);
    mocks.listArtifacts.mockResolvedValue([
      { id: 'art_1', title: 'Doc', type: 'markdown' },
    ]);
    mocks.listRuns.mockResolvedValue([
      { id: 3, status: 'success', startedAt: 1, finishedAt: 2, summary: 'done' },
    ]);

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_projects__projects_workspace_summary'
    );
    const result = await tool!.execute(context, {});
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      workspaceId: 'orbit-workspace',
      counts: {
        conversations: 1,
        tasks: 1,
        artifacts: 1,
        workflowRuns: 1,
      },
      conversations: [{ id: 1, title: 'Chat' }],
      tasks: [{ id: 2, status: 'open' }],
      artifacts: [{ id: 'art_1', type: 'markdown' }],
    });
  });

  it('reports stable scope IDs and redacts workflow summaries', async () => {
    const harness = await enableProjects();
    mocks.listWorkflows.mockResolvedValue([{ id: 9, name: 'Nightly' }]);
    mocks.listRuns.mockResolvedValue([
      {
        id: 5,
        workflowId: 9,
        workflowName: 'Nightly',
        status: 'success',
        startedAt: 1,
        finishedAt: 2,
        summary: 'api_key=secret-value completed',
      },
    ]);

    const scopes = harness.toolHost.tools.get(
      'plugin__orbit_builtin_projects__projects_scopes'
    );
    const runs = harness.toolHost.tools.get(
      'plugin__orbit_builtin_projects__projects_workflow_runs'
    );

    const scopeResult = JSON.parse((await scopes!.execute(context, {})).content);
    expect(scopeResult).toMatchObject({
      ok: true,
      scopes: [
        { id: 'orbit-workspace' },
        { id: 'orbit-agent-actions' },
        { id: 'workflow-9', label: 'Workflow: Nightly' },
      ],
    });

    const runResult = JSON.parse((await runs!.execute(context, {})).content);
    expect(runResult).toMatchObject({
      ok: true,
      total: 1,
      runs: [{ id: 5, workflowId: 9, status: 'success' }],
    });
    expect(runResult.runs[0].summary).not.toContain('secret-value');
  });
});
