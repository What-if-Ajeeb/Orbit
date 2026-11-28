import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionEvent } from '../chat-store';
import type { AgentIdentity } from '../permissions/types';
import { secureExecuteTool } from '../permissions/executor';
import { findSkillTool } from '../skills/manifest';
import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { dispatchCapabilityCall, type DispatchContext } from './dispatcher';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'dispatch-test-uuid' }));
vi.mock('../agent-settings', () => ({ newToolEventId: () => 'event-1' }));
vi.mock('../ai/tools', () => ({ agentToolRegistry: { get: () => ({ timeoutMs: 1_000 }) }, executeTool: vi.fn() }));
vi.mock('../ai/tool-registry', () => ({ toolFail: (error: string) => JSON.stringify({ ok: false, error }) }));
vi.mock('../permissions/executor', () => ({ secureExecuteTool: vi.fn() }));
vi.mock('../permissions/redact', () => ({ redactSecrets: (value: string) => value }));
vi.mock('../policy', () => ({ policyEngine: { evaluatePolicyForExecution: vi.fn() } }));
vi.mock('../sandbox/adapters', () => ({ sandboxGate: vi.fn(async () => undefined) }));
vi.mock('../skills/executor', () => ({ executeDeclarativeSkill: vi.fn() }));
vi.mock('../skills/manifest', () => ({ findSkillTool: vi.fn(() => null) }));
vi.mock('../telemetry', () => ({ TelemetryStore: class {} }));
vi.mock('./audit', () => ({ recordHybridEvent: vi.fn(async () => undefined) }));

const agent: AgentIdentity = {
  id: 'master',
  name: 'Master',
  role: 'master',
  description: '',
  icon: 'sparkles',
};

let db: TestDatabase;

beforeEach(() => {
  vi.clearAllMocks();
  db = createTestDatabase();
});

function context(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    db,
    userId: 1,
    conversationId: 1,
    agent,
    projectId: 'workspace',
    projectLabel: 'Workspace',
    taskId: 'task-1',
    manifests: [],
    allowedTool: () => true,
    emit: vi.fn(async () => undefined),
    telemetry: { recordToolCall: vi.fn(async () => undefined) } as unknown as DispatchContext['telemetry'],
    trace: { traceId: 'trace-dispatch' },
    policyEvaluation: {
      decision: 'allow',
      ruleId: 'rule-1',
      ruleName: 'Rule 1',
      reason: 'allowed',
      sandbox: {},
      policyVersion: 'v17',
    },
    ...overrides,
  };
}

function secured(content = '{"ok":true}') {
  return {
    success: true,
    content,
    trace: 'done',
    durationMs: 2,
    permission: { requestId: 'permission-1', allowed: true, risk: 'high', category: 'file_read' },
  } as unknown as Awaited<ReturnType<typeof secureExecuteTool>>;
}

describe('hybrid dispatch boundary', () => {
  it('turns a sensitive call into an ask decision at the execution boundary', async () => {
    vi.mocked(secureExecuteTool).mockResolvedValue(secured());

    const result = await dispatchCapabilityCall(
      { toolName: 'mcp__files_read', args: { path: '/a.txt' } },
      context({ forceApproval: true })
    );

    expect(vi.mocked(secureExecuteTool).mock.calls[0][0].policy).toMatchObject({
      decision: 'ask',
      policyVersion: 'v17',
    });
    expect(result.policyDecision).toBe('ask');
    expect(result.permissionRequestId).toBe('permission-1');
    expect(result.verification.verified).toBe(true);
    expect(result.toolEvents.map((event) => event.status)).toEqual(['success']);
  });

  it('refuses to run a sensitive call as a declarative skill', async () => {
    const skillTool = {
      manifest: {
        id: 'skill_test',
        name: 'Test Skill',
        capabilities: [{ name: 'lookup', description: '', steps: [] }],
      },
      capability: { name: 'lookup', description: '', steps: [] },
    };
    vi.mocked(findSkillTool).mockReturnValueOnce(skillTool as never);

    const result = await dispatchCapabilityCall(
      { toolName: 'skill_test_lookup', args: {} },
      context({ forceApproval: true })
    );

    expect(secureExecuteTool).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/direct, exact approval/);
    expect(result.verification.verified).toBe(false);
  });

  it('emits artifact-specific progress without persisting artifact content', async () => {
    vi.mocked(secureExecuteTool).mockResolvedValue(secured());
    const events: ToolExecutionEvent[] = [];

    await dispatchCapabilityCall(
      {
        toolName: 'artifact_create',
        args: {
          title: 'Launch plan',
          type: 'html',
          content: 'const secret = "never show this";',
        },
      },
      context({
        onToolEvent: (event) => {
          events.push({ ...event });
        },
      })
    );

    expect(events[0]).toMatchObject({
      status: 'running',
      summary: 'Creating “Launch plan”',
    });
    expect(events[0].detail).toContain('Page');
    expect(JSON.stringify(events)).not.toContain('never show this');
  });

  it('denies capabilities that are not enabled for the agent', async () => {
    const result = await dispatchCapabilityCall(
      { toolName: 'memory_remember', args: { key: 'a', value: 'b' } },
      context({ allowedTool: () => false })
    );

    expect(secureExecuteTool).not.toHaveBeenCalled();
    expect(result.policyDecision).toBe('deny');
    expect(result.success).toBe(false);
    expect(result.toolEvents.map((event) => event.status)).toEqual(['denied']);
  });
});
