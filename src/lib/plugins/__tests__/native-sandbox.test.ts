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
  validateManifest: vi.fn(),
  checkPermission: vi.fn(),
  validatePath: vi.fn(),
  validateNetwork: vi.fn(),
  validateRequest: vi.fn(),
  authorizeOperation: vi.fn(),
}));

vi.mock('@/lib/sandbox/manager', () => ({
  getMobileSandboxManager: () => ({
    initialize: mocks.initialize,
    getSnapshot: mocks.getSnapshot,
    validateManifest: mocks.validateManifest,
    checkPermission: mocks.checkPermission,
    validatePath: mocks.validatePath,
    validateNetwork: mocks.validateNetwork,
    validateRequest: mocks.validateRequest,
    authorizeOperation: mocks.authorizeOperation,
    onAudit: () => () => undefined,
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

const audit = {
  id: 'audit-1',
  at: 1,
  pluginId: 'local.test.plugin',
  operation: 'manifest.validate',
  decision: 'allow',
  reasonCode: 'valid',
  permission: null,
  resourceHash: null,
  bytes: 0,
  durationMs: 0,
  policyVersion: 2,
};

describe('ORBIT Sandbox native plugin', () => {
  it('is Android-only and declares read-only sandbox inspection', () => {
    const manifest = NATIVE_PLUGIN_MANIFESTS.find(
      (entry) => entry.pluginId === SANDBOX_PLUGIN_ID
    )!;

    expect(manifest.platformSupport).toEqual(['android']);
    expect(manifest.permissions).toEqual(['ai.invoke', 'sandbox.inspect']);
    expect(manifest.version).toBe('2.0.0');
  });

  it('exposes the security policy without executing anything', async () => {
    const { harness } = await enableSandbox();
    mocks.initialize.mockResolvedValue({
      coreVersion: '0.2.0',
      policyVersion: 2,
      isolation: 'android-isolated-process',
      securityCapabilities: ['manifest-validation', 'permission-enforcement'],
      allowedOperations: ['file.read', 'file.stat', 'network.request'],
      permissions: ['files.read', 'sandbox.inspect'],
      execution: false,
      limits: { maxFileBytes: 262144, approvalTtlSeconds: 300 },
    });
    mocks.getSnapshot.mockReturnValue({ sessions: [], busy: 0 });

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_policy'
    );
    const result = JSON.parse((await tool!.execute(context, {})).content);

    expect(result).toMatchObject({
      ok: true,
      policyVersion: 2,
      execution: false,
      isolation: 'android-isolated-process',
      sessionCount: 0,
      busy: 0,
    });
  });

  it('rejects a policy that still advertises execution', async () => {
    const { harness } = await enableSandbox();
    mocks.initialize.mockResolvedValue({
      coreVersion: '0.2.0',
      policyVersion: 2,
      isolation: 'android-isolated-process',
      securityCapabilities: [],
      allowedOperations: [],
      permissions: [],
      execution: true,
      limits: {},
    });

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_policy'
    );
    const result = JSON.parse((await tool!.execute(context, {})).content);
    expect(result).toMatchObject({ ok: false });
  });

  it('validates manifests and rejects execution-shaped declarations', async () => {
    const { harness, confirmSensitiveTool } = await enableSandbox();
    mocks.validateManifest.mockResolvedValue({
      ok: false,
      errors: ['Manifest field "program" is not allowed.'],
      policyVersion: 2,
      audit: { ...audit, decision: 'deny', reasonCode: 'invalid_manifest' },
    });

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_validate_manifest'
    );
    const result = JSON.parse(
      (await tool!.execute(context, { manifest: { pluginId: 'x.y' } })).content
    );

    expect(result).toMatchObject({
      ok: true,
      validation: { ok: false },
    });
    expect(JSON.stringify(result)).toMatch(/program/);
    expect(confirmSensitiveTool).not.toHaveBeenCalled();
  });

  it('validates paths and networks without touching either resource', async () => {
    const { harness } = await enableSandbox();
    mocks.validatePath.mockResolvedValue({
      ok: false,
      normalizedPath: null,
      errors: ['path_traversal: Path traversal segments are not allowed.'],
      policyVersion: 2,
      audit: { ...audit, decision: 'deny', operation: 'path.validate' },
    });
    mocks.validateNetwork.mockResolvedValue({
      ok: true,
      normalizedUrl: 'https://example.com/path',
      errors: [],
      policyVersion: 2,
      audit,
    });

    const pathTool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_validate_path'
    );
    const networkTool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_validate_network'
    );

    const pathResult = JSON.parse(
      (await pathTool!.execute(context, { path: '../secret' })).content
    );
    const networkResult = JSON.parse(
      (await networkTool!.execute(context, { url: 'https://example.com/path' })).content
    );

    expect(pathResult.report.ok).toBe(false);
    expect(pathResult.report.normalizedPath).toBeNull();
    expect(networkResult.report.normalizedUrl).toBe('https://example.com/path');
    expect(mocks.validatePath).toHaveBeenCalledWith('../secret');
  });

  it('authorizes operations without performing them and fails closed on bridge errors', async () => {
    const { harness } = await enableSandbox();
    mocks.authorizeOperation.mockResolvedValueOnce({
      decision: 'deny',
      operation: 'file.read',
      permission: 'files.read',
      normalizedResource: null,
      reason: 'A fresh user approval is required for files.read.',
      reasonCode: 'approval_required',
      policyVersion: 2,
      limits: {},
      audit: { ...audit, decision: 'deny', reasonCode: 'approval_required' },
    });

    const tool = harness.toolHost.tools.get(
      'plugin__orbit_builtin_sandbox__sandbox_authorize_operation'
    );

    const denied = JSON.parse(
      (
        await tool!.execute(context, {
          manifest: { pluginId: 'local.test.plugin', version: '1.0.0' },
          operation: 'file.read',
          resource: { path: 'orbit/note.txt' },
        })
      ).content
    );
    expect(denied.decision.decision).toBe('deny');
    expect(denied.decision.reasonCode).toBe('approval_required');

    mocks.authorizeOperation.mockRejectedValueOnce(
      new Error('The ORBIT mobile sandbox is only available on Android.')
    );
    const unavailable = JSON.parse(
      (
        await tool!.execute(context, {
          manifest: { pluginId: 'local.test.plugin', version: '1.0.0' },
          operation: 'file.read',
          resource: { path: 'orbit/note.txt' },
        })
      ).content
    );
    expect(unavailable).toMatchObject({ ok: false });
  });
});
