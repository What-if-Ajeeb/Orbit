import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';

import { classifyToolAction } from './classifier';
import { secureExecuteTool } from './executor';
import { permissionManager } from './manager';
import type {
  AgentIdentity,
  ClassifiedPermissionAction,
  PermissionAuthorization,
  PermissionRequestRecord,
} from './types';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

vi.mock('./devices', () => ({
  listPairedDevices: vi.fn(async () => []),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  PermissionsAndroid: {
    PERMISSIONS: {
      CAMERA: 'camera',
      RECORD_AUDIO: 'record_audio',
      ACCESS_FINE_LOCATION: 'fine_location',
      ACCESS_COARSE_LOCATION: 'coarse_location',
      READ_CONTACTS: 'read_contacts',
    },
    RESULTS: { GRANTED: 'granted' },
    check: vi.fn(async () => true),
    request: vi.fn(async () => 'granted'),
  },
}));

const AGENT: AgentIdentity = {
  id: 'developer',
  name: 'Developer Agent',
  role: 'specialist',
  description: 'Writes code',
  icon: 'code-slash',
};

const DB = {} as SQLiteDatabase;

function classify(toolName: string, args: Record<string, unknown>): ClassifiedPermissionAction {
  return classifyToolAction({
    toolName,
    args,
    agent: AGENT,
    projectId: 'project-1',
    projectLabel: 'Orbit',
  });
}

function requestFor(action: ClassifiedPermissionAction): PermissionRequestRecord {
  const now = Date.now();

  return {
    id: 'req-1',
    userId: 1,
    agentId: action.agent.id,
    agentName: action.agent.name,
    agentRole: action.agent.role,
    category: action.category,
    risk: action.risk,
    toolName: action.toolName,
    projectId: action.projectId,
    projectLabel: action.projectLabel,
    conversationId: 9,
    title: action.title,
    summary: action.summary,
    actions: action.actions,
    target: action.target,
    reason: action.reason,
    commandPreview: action.commandPreview,
    scopeKey: action.scopeKey,
    resourceKey: action.resourceKey,
    fingerprint: action.fingerprint,
    freshConfirmation: action.freshConfirmation,
    reversible: action.reversible,
    external: action.external,
    allowAlways: action.allowAlways,
    status: 'approved_once',
    resolution: 'allow_once',
    createdAt: now,
    expiresAt: now + 60_000,
    resolvedAt: now,
    metadata: { policyDecision: 'ask' },
  };
}

function authorizationFor(
  action: ClassifiedPermissionAction,
  request: PermissionRequestRecord
): PermissionAuthorization {
  const now = Date.now();

  return {
    id: 'auth-1',
    requestId: request.id,
    grantId: null,
    userId: request.userId,
    agentId: request.agentId,
    agentName: request.agentName,
    toolName: request.toolName,
    category: request.category,
    risk: request.risk,
    scopeKey: request.scopeKey,
    resourceKey: request.resourceKey,
    fingerprint: request.fingerprint,
    projectId: request.projectId,
    conversationId: request.conversationId,
    freshConfirmation: request.freshConfirmation,
    reversible: request.reversible,
    external: request.external,
    action: request.title,
    once: true,
    issuedAt: now,
    expiresAt: now + 60_000,
  };
}

type Spies = {
  activity: ReturnType<typeof vi.spyOn>;
  finishOperation: ReturnType<typeof vi.spyOn>;
  beginExecution: ReturnType<typeof vi.spyOn>;
};

function allow(action: ClassifiedPermissionAction): Spies {
  const request = requestFor(action);
  const authorization = authorizationFor(action, request);
  const operation = { id: 'op-1', signal: new AbortController().signal };

  vi.spyOn(permissionManager, 'attach').mockImplementation(() => undefined);
  vi.spyOn(permissionManager, 'recordAudit').mockResolvedValue(undefined);
  const activity = vi.spyOn(permissionManager, 'recordActivity').mockResolvedValue(undefined);
  vi.spyOn(permissionManager, 'requestToolPermission').mockResolvedValue({
    allowed: true,
    authorization,
    request,
    via: 'allow_once',
  });
  vi.spyOn(permissionManager, 'startOperation').mockReturnValue(operation);
  const beginExecution = vi
    .spyOn(permissionManager, 'beginExecution')
    .mockResolvedValue({ ok: true, request });
  vi.spyOn(permissionManager, 'finishExecution').mockResolvedValue(undefined);
  const finishOperation = vi
    .spyOn(permissionManager, 'finishOperation')
    .mockResolvedValue(undefined);

  return { activity, finishOperation, beginExecution };
}

describe('secure executor safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reports an external timeout as uncertain instead of claiming cancellation', async () => {
    const action = classify('google_gmail_send', {
      to: 'someone@example.com',
      body: 'Hello',
    });
    const spies = allow(action);
    const execute = vi.fn(() => new Promise<never>(() => undefined));

    const pending = secureExecuteTool({
      db: DB,
      userId: 1,
      agent: AGENT,
      conversationId: 9,
      projectId: 'project-1',
      projectLabel: 'Orbit',
      toolName: action.toolName,
      rawArguments: JSON.stringify({ to: 'someone@example.com', body: 'Hello' }),
      policy: { decision: 'ask', ruleId: null },
      timeoutMs: 1_000,
      execute,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TOOL_TIMEOUT');
    expect(result.trace).toBe('UNCERTAIN google_gmail_send');
    expect(result.error).toMatch(/may have completed/i);
    expect(spies.finishOperation).toHaveBeenCalledWith(
      1,
      'op-1',
      'unknown',
      expect.stringContaining('may have completed')
    );
    expect(spies.activity).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unknown', external: true })
    );
    expect(spies.beginExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'auth-1' }),
      expect.objectContaining({
        fingerprint: action.fingerprint,
        external: true,
        freshConfirmation: true,
      })
    );
  });

  it('reports a stopped local tool as stopped, not unknown', async () => {
    const action = classify('file_restore', { trash_id: 'trash-1' });
    const spies = allow(action);
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(async () => ({ content: '{"ok":true}', trace: 'restored' }));

    const result = await secureExecuteTool({
      db: DB,
      userId: 1,
      agent: AGENT,
      conversationId: 9,
      projectId: 'project-1',
      projectLabel: 'Orbit',
      toolName: action.toolName,
      rawArguments: JSON.stringify({ trash_id: 'trash-1' }),
      policy: { decision: 'ask', ruleId: null },
      signal: controller.signal,
      execute,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TOOL_CANCELLED');
    expect(result.error).not.toMatch(/may have completed/i);
    expect(spies.finishOperation).toHaveBeenCalledWith(
      1,
      'op-1',
      'stopped',
      expect.any(String)
    );
    expect(spies.activity).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'stopped', external: false })
    );
  });

  it('never executes a denied plugin tool', async () => {
    const action = classify('plugin__untrusted__run', { payload: 'anything' });
    const execute = vi.fn(async () => ({ content: '{"ok":true}', trace: 'ran' }));

    vi.spyOn(permissionManager, 'attach').mockImplementation(() => undefined);
    vi.spyOn(permissionManager, 'recordAudit').mockResolvedValue(undefined);
    vi.spyOn(permissionManager, 'recordActivity').mockResolvedValue(undefined);
    vi.spyOn(permissionManager, 'requestToolPermission').mockResolvedValue({
      allowed: false,
      reason: 'policy_denied',
      message: 'Blocked by policy.',
    });
    vi.spyOn(permissionManager, 'startOperation').mockReturnValue({
      id: 'op-2',
      signal: new AbortController().signal,
    });

    const result = await secureExecuteTool({
      db: DB,
      userId: 1,
      agent: AGENT,
      conversationId: 9,
      projectId: 'project-1',
      projectLabel: 'Orbit',
      toolName: action.toolName,
      rawArguments: JSON.stringify({ payload: 'anything' }),
      policy: { decision: 'deny', ruleId: null },
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.permission.allowed).toBe(false);
    expect(result.permission.reason).toBe('policy_denied');
    expect(result.pipeline.executed).toBe(false);
    expect(result.pipeline.denial).toBe('policy_denied');
    expect(result.pipeline.finalized).toBe(true);
  });
});
