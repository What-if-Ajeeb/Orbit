import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildGitCommand, getAgentActionIntegration } from './integrations';
import {
  approveAction,
  cancelAction,
  createAgentAction,
  editAction,
  executeAction,
  getAgentAction,
  rejectAction,
  requestActionApproval,
} from './service';

const state = vi.hoisted(() => ({
  queue: [] as any[],
  listeners: new Set<() => void>(),
  outcomes: new Map<string, { resolve: (value: any) => void; reject: (error: unknown) => void }>(),
  requests: new Map<string, { request: any; action: any }>(),
  activity: [] as any[],
  audits: [] as any[],
  secure: vi.fn(),
  registryGet: vi.fn(),
  cancelRequest: vi.fn(),
  resolveRequest: vi.fn(),
}));

vi.mock('@/lib/permissions/manager', () => {
  function notify() {
    for (const listener of Array.from(state.listeners)) {
      listener();
    }
  }

  function stable(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(stable).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${key}:${stable(entry)}`)
        .join(',')}}`;
    }

    return String(value ?? null);
  }

  function outcomeFor(option: string, entry: { request: any; action: any }) {
    const { request, action } = entry;

    if (option === 'deny') {
      return {
        allowed: false,
        reason: 'user_denied',
        message: 'You rejected this action.',
        request,
      };
    }

    if (option === 'cancel') {
      return {
        allowed: false,
        reason: 'user_cancelled',
        message: 'You cancelled this action.',
        request,
      };
    }

    const now = Date.now();

    return {
      allowed: true,
      via: 'allow_once',
      authorization: {
        id: `auth-${request.id}`,
        requestId: request.id,
        grantId: null,
        userId: request.userId,
        agentId: action.agent.id,
        agentName: action.agent.name,
        toolName: action.toolName,
        category: action.category,
        risk: action.risk,
        scopeKey: action.scopeKey,
        resourceKey: action.resourceKey,
        fingerprint: action.fingerprint,
        projectId: action.projectId,
        conversationId: request.conversationId,
        freshConfirmation: action.freshConfirmation,
        reversible: action.reversible,
        external: action.external,
        action: action.title,
        once: true,
        issuedAt: now,
        expiresAt: now + 60_000,
      },
      request: { ...request, status: 'approved_once', resolution: 'allow_once', resolvedAt: now },
    };
  }

  return {
    permissionManager: {
      getState: () => ({ queue: state.queue }),
      subscribe: (listener: () => void) => {
        state.listeners.add(listener);
        return () => {
          state.listeners.delete(listener);
        };
      },
      attach: vi.fn(),
      requestToolPermission: vi.fn(async (input: any) => {
        const request = {
          id: `req-${state.requests.size + 1}`,
          userId: input.userId,
          conversationId: input.conversationId ?? null,
          agentId: input.action.agent.id,
          agentName: input.action.agent.name,
          agentRole: input.action.agent.role,
          category: input.action.category,
          risk: input.action.risk,
          toolName: input.action.toolName,
          projectId: input.action.projectId,
          projectLabel: input.action.projectLabel,
          title: input.action.title,
          summary: input.action.summary,
          actions: input.action.actions,
          target: input.action.target,
          reason: input.action.reason,
          scopeKey: input.action.scopeKey,
          resourceKey: input.action.resourceKey,
          fingerprint: input.action.fingerprint,
          freshConfirmation: input.action.freshConfirmation,
          reversible: input.action.reversible,
          external: input.action.external,
          allowAlways: input.action.allowAlways,
          status: 'pending',
          resolution: null,
          createdAt: Date.now(),
          expiresAt: Date.now() + 600_000,
          metadata: { ...input.action.metadata, policyDecision: input.policy.decision },
        };

        let resolve!: (value: any) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<any>((res, rej) => {
          resolve = res;
          reject = rej;
        });

        state.outcomes.set(request.id, { resolve, reject });
        state.requests.set(request.id, { request, action: input.action });
        state.queue.push(request);
        notify();
        void stable(input.action);
        return promise;
      }),
      resolveRequest: state.resolveRequest.mockImplementation(async (requestId: string, option: string) => {
        const entry = state.requests.get(requestId);

        if (!entry || !state.queue.some((request) => request.id === requestId)) {
          return { ok: false, message: 'This request is no longer pending.' };
        }

        state.queue = state.queue.filter((request) => request.id !== requestId);
        const outcome = outcomeFor(option, entry);
        state.outcomes.get(requestId)?.resolve(outcome);
        notify();
        return { ok: true };
      }),
      cancelRequest: state.cancelRequest.mockImplementation(async (requestId: string) => {
        const entry = state.requests.get(requestId);

        if (!entry || !state.queue.some((request) => request.id === requestId)) {
          return { ok: false, message: 'This request is no longer pending.' };
        }

        state.queue = state.queue.filter((request) => request.id !== requestId);
        state.outcomes.get(requestId)?.resolve(outcomeFor('cancel', entry));
        notify();
        return { ok: true };
      }),
      recordActivity: vi.fn(async (input: any) => {
        state.activity.push(input);
      }),
      recordAudit: vi.fn(async (input: any) => {
        state.audits.push(input);
      }),
    },
  };
});

vi.mock('@/lib/permissions/executor', () => ({
  secureExecuteTool: (...args: any[]) => state.secure(...args),
}));

vi.mock('@/lib/ai/tool-registry', () => ({
  agentToolRegistry: {
    get: (...args: any[]) => state.registryGet(...args),
  },
}));

vi.mock('@/lib/policy', () => ({
  policyEngine: {
    evaluate: () => ({
      decision: 'allow',
      ruleId: 'rule-1',
      ruleName: 'Test allow',
      sandbox: {},
      reason: 'Allowed by test policy.',
    }),
  },
}));

vi.mock('@/lib/permissions/classifier', () => {
  function stable(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(stable).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${key}:${stable(entry)}`)
        .join(',')}}`;
    }

    return String(value ?? null);
  }

  return {
    classifyToolAction: (input: any) => ({
      agent: input.agent,
      category: 'external_api',
      risk: 'high',
      toolName: input.toolName,
      title: `${input.toolName} action`,
      summary: 'Test summary',
      actions: ['Confirm exact payload'],
      target: { kind: 'app', label: String(input.args.to ?? input.args.path ?? '') },
      reason: 'Sensitive external action.',
      commandPreview: null,
      projectId: input.projectId,
      projectLabel: input.projectLabel,
      scopeKey: 'scope-1',
      resourceKey: 'resource-1',
      fingerprint: stable({ tool: input.toolName, args: input.args }),
      narrowable: false,
      freshConfirmation: true,
      reversible: false,
      external: true,
      cancellable: false,
      consequences: ['The external service will be changed.'],
      allowAlways: false,
      autoApprove: false,
      metadata: {},
    }),
  };
});

const AGENT = {
  id: 'agent-1',
  name: 'Test Agent',
  role: 'specialist',
  description: 'Handles approved actions',
  icon: 'sparkles-outline',
} as const;

const EMAIL = {
  to: 'person@example.com',
  subject: 'Status update',
  body: 'The build is complete.',
};

function createDb() {
  const rows = new Map<string, Record<string, any>>();

  const db = {
    getFirstAsync: vi.fn(async (_sql: string, id: string) => rows.get(id) ?? null),
    getAllAsync: vi.fn(async () => Array.from(rows.values())),
    runAsync: vi.fn(async (sql: string, ...params: any[]) => {
      if (sql.startsWith('INSERT')) {
        const columns = [
          'id',
          'user_id',
          'conversation_id',
          'agent_id',
          'agent_name',
          'kind',
          'tool_name',
          'status',
          'title',
          'target',
          'payload',
          'tool_args',
          'fingerprint',
          'permission_request_id',
          'risk',
          'category',
          'approval_fingerprint',
          'approved_at',
          'result',
          'error',
          'trace',
          'created_at',
          'updated_at',
        ];
        const row: Record<string, any> = {};
        columns.forEach((column, index) => {
          row[column] = params[index];
        });
        rows.set(row.id, row);
        return;
      }

      if (sql.startsWith('UPDATE')) {
        const idIndex = params.length - 2;
        const row = rows.get(String(params[idIndex]));

        if (!row) {
          return;
        }

        const columns = [
          'status',
          'tool_name',
          'title',
          'target',
          'payload',
          'tool_args',
          'fingerprint',
          'permission_request_id',
          'risk',
          'category',
          'approval_fingerprint',
          'approved_at',
          'result',
          'error',
          'trace',
          'updated_at',
        ];
        columns.forEach((column, index) => {
          row[column] = params[index];
        });
      }
    }),
  };

  return db as unknown as SQLiteDatabase;
}

async function createEmailAction(db: SQLiteDatabase, id = 'action_email') {
  return createAgentAction(db, {
    id,
    userId: 7,
    conversationId: 42,
    agent: AGENT,
    kind: 'email',
    payload: EMAIL,
  });
}

async function armAction(db: SQLiteDatabase, id: string) {
  await requestActionApproval(db, id, 7);
  return approveAction(db, id, 7);
}

beforeEach(() => {
  state.queue.length = 0;
  state.listeners.clear();
  state.outcomes.clear();
  state.requests.clear();
  state.activity.length = 0;
  state.audits.length = 0;
  state.secure.mockReset();
  state.secure.mockResolvedValue({
    success: true,
    content: 'Email sent: message-1',
    trace: 'pipeline=classify>authorize>guard>execute',
    durationMs: 25,
  });
  state.registryGet.mockReset();
  state.registryGet.mockReturnValue({ timeoutMs: 1_000, execute: vi.fn(async () => ({ ok: true })) });
  state.cancelRequest.mockClear();
  state.resolveRequest.mockClear();
});

describe('agent action cards', () => {
  it('prepares an exact email payload without executing it', async () => {
    const db = createDb();
    const action = await createEmailAction(db);

    expect(action.status).toBe('draft');
    expect(action.toolName).toBe('google_gmail_send');
    expect(action.toolArgs).toEqual(EMAIL);
    expect(action.target).toBe(EMAIL.to);
    expect(action.lines.join(' ')).toContain(EMAIL.subject);
    expect(state.secure).not.toHaveBeenCalled();
  });

  it('approves, revalidates and executes the exact confirmed action once', async () => {
    const db = createDb();
    const created = await createEmailAction(db);
    const approved = await armAction(db, created.id);

    expect(approved.status).toBe('approved');
    expect(approved.approvalFingerprint).toBe(approved.fingerprint);

    const result = await executeAction(db, created.id, 7);

    expect(result.success).toBe(true);
    expect(state.secure).toHaveBeenCalledTimes(1);

    const input = state.secure.mock.calls[0][0];

    expect(input.rawArguments).toBe(JSON.stringify(EMAIL));
    expect(input.authorization.fingerprint).toBe(created.fingerprint);
    expect(input.authorizationRequest.metadata.agentActionId).toBe(created.id);

    const stored = await getAgentAction(db, created.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.result).toBe('Email sent: message-1');
    expect(state.activity.map((entry) => entry.status)).toEqual(
      expect.arrayContaining(['pending', 'approved', 'running', 'success'])
    );
  });

  it('invalidates approval when the exact payload is edited', async () => {
    const db = createDb();
    const created = await createEmailAction(db);
    await armAction(db, created.id);

    const edited = await editAction(db, created.id, 7, {
      ...EMAIL,
      body: 'Edited after approval.',
    });

    expect(edited.status).toBe('draft');
    expect(edited.approvalFingerprint).toBeNull();
    expect(edited.fingerprint).not.toBe(created.fingerprint);
    expect(edited.error).toContain('Approval was invalidated');
    expect(state.cancelRequest).toHaveBeenCalled();

    await expect(executeAction(db, created.id, 7)).rejects.toThrow(
      'Only explicitly approved actions can execute.'
    );
    expect(state.secure).not.toHaveBeenCalled();
  });

  it('rejects a pending action without executing it', async () => {
    const db = createDb();
    const created = await createEmailAction(db);
    await requestActionApproval(db, created.id, 7);

    const rejected = await rejectAction(db, created.id, 7);

    expect(rejected.status).toBe('rejected');
    expect(state.resolveRequest).toHaveBeenCalledWith(expect.any(String), 'deny', 7);
    expect(state.secure).not.toHaveBeenCalled();
  });

  it('cancels an armed action and records the outcome', async () => {
    const db = createDb();
    const created = await createEmailAction(db);
    await armAction(db, created.id);

    const cancelled = await cancelAction(db, created.id, 7);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.approvalFingerprint).toBeNull();
    expect(state.activity.at(-1)?.status).toBe('cancelled');
    expect(state.secure).not.toHaveBeenCalled();
  });

  it('prevents duplicate execution for the same action id', async () => {
    const db = createDb();
    const created = await createEmailAction(db);
    await armAction(db, created.id);

    let slowResolve!: (value: any) => void;
    state.secure.mockImplementation(
      () =>
        new Promise((resolve) => {
          slowResolve = resolve;
        })
    );

    const first = executeAction(db, created.id, 7);
    const second = executeAction(db, created.id, 7);

    await expect(second).rejects.toThrow('This action is already executing.');
    slowResolve({
      success: true,
      content: 'done',
      trace: 'ok',
      durationMs: 1,
    });
    await expect(first).resolves.toMatchObject({ success: true });
    expect(state.secure).toHaveBeenCalledTimes(1);
  });

  it('records a real tool failure and keeps the action non-retryable', async () => {
    const db = createDb();
    const created = await createEmailAction(db);
    await armAction(db, created.id);
    state.secure.mockResolvedValue({
      success: false,
      content: '',
      trace: 'failed',
      durationMs: 5,
      error: 'Gmail connection expired.',
    });

    const result = await executeAction(db, created.id, 7);

    expect(result.success).toBe(false);
    const stored = await getAgentAction(db, created.id);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toBe('Gmail connection expired.');
    expect(state.activity.at(-1)?.status).toBe('failed');

    await expect(executeAction(db, created.id, 7)).rejects.toThrow(
      'Only explicitly approved actions can execute.'
    );
  });

  it('builds an exact git diff command and blocks forced pushes', () => {
    expect(buildGitCommand({ operation: 'diff', repoPath: '/workspace/orbit' })).toEqual({
      command: "git -C '/workspace/orbit' diff",
      error: null,
    });

    expect(buildGitCommand({ operation: 'push', repoPath: '/workspace/orbit', remote: 'origin' })).toEqual({
      command: "git -C '/workspace/orbit' push 'origin'",
      error: null,
    });

    expect(
      getAgentActionIntegration('git')?.describe({
        operation: 'diff',
        repoPath: '/workspace/orbit',
      }).lines
    ).toContain("Command: git -C '/workspace/orbit' diff");
  });

  it('rejects invalid integration payloads at draft creation', async () => {
    const db = createDb();

    await expect(
      createAgentAction(db, {
        id: 'action_bad_email',
        userId: 7,
        agent: AGENT,
        kind: 'email',
        payload: { to: 'not-an-email', subject: '', body: '' },
      })
    ).rejects.toThrow('Enter a valid recipient email address.');
  });
});
