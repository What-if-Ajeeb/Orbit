import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PolicyEvaluation } from '../policy';
import {
  createAgentTask,
  createAgentTaskApproval,
  createAgentTaskSchedule,
  getAgentTask,
  getAgentTaskApproval,
  recordAgentTaskAttempt,
} from '../agent-runtime/task-manager';
import {
  combineVerifications,
  unverified,
  verificationFailed,
  verifyToolCall,
} from '../agent-runtime/verification';
import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import {
  approvalStillMatches,
  buildApprovalBinding,
  enterApprovalWait,
  resolveApprovalWait,
} from './approvals';
import { recordHybridEvent, readHybridTrace, verifyHybridTrace } from './audit';
import { buildCapabilityCatalog } from './capability-catalog';
import { buildPlan, planIsProhibited, planRequiresApproval } from './planner';
import { recoverHybridAgentTasks } from './recovery';
import { decideRisk, operationFingerprint } from './risk-controller';
import { assertTransition, canTransition, fromLegacyStatus, toLegacyStatus } from './state';
import type { ApprovalBinding, HybridTaskState } from './types';
import { verificationToState } from './verification';

vi.mock('expo-crypto', () => ({ randomUUID: () => `hybrid-test-${Math.random().toString(36).slice(2)}` }));

const policy = (
  decision: PolicyEvaluation['decision'] = 'allow',
  reason = 'test policy'
): PolicyEvaluation => ({
  decision,
  ruleId: 'rule-1',
  ruleName: 'Rule 1',
  sandbox: {},
  reason,
});

const risk = (overrides: Partial<Parameters<typeof buildApprovalBinding>[0]['risk']> = {}) => ({
  decision: 'APPROVAL_REQUIRED' as const,
  risk: 'high' as const,
  reason: 'Sensitive capability.',
  operationFingerprint: 'fp-1',
  requiresFreshConfirmation: true,
  ...overrides,
});

const catalog = () =>
  buildCapabilityCatalog({
    skillNames: [],
  }).concat([
    { name: 'list_tasks', kind: 'builtin' },
    { name: 'mcp__files_read', kind: 'mcp', riskHint: 'medium', sensitive: true },
  ]);


function makeBinding(taskId: string, args: Record<string, unknown> = { path: '/a.txt' }): ApprovalBinding {
  return buildApprovalBinding({
    taskId,
    stepId: 'step-1',
    toolName: 'mcp__files_read',
    args,
    risk: risk({ operationFingerprint: operationFingerprint({ toolName: 'mcp__files_read', args }) }),
    scopeKey: 'workspace',
    resourceKey: '/a.txt',
    policyVersion: 'v17',
  });
}

function newDb(): TestDatabase {
  const database = createTestDatabase();
  database.raw.prepare('INSERT OR IGNORE INTO users (id, name) VALUES (1, ?)').run('Test User');
  return database;
}

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

describe('hybrid canonical state machine', () => {
  it('only allows declared forward transitions', () => {
    expect(canTransition('QUEUED', 'PLANNING')).toBe(true);
    expect(canTransition('RUNNING', 'WAITING_FOR_APPROVAL')).toBe(true);
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(() => assertTransition('CANCELLED', 'COMPLETED')).toThrow(/Invalid hybrid task transition/);
  });

  it('maps to and from the v16 legacy statuses', () => {
    expect(toLegacyStatus('BLOCKED')).toBe('needs_review');
    expect(toLegacyStatus('WAITING_FOR_APPROVAL')).toBe('awaiting_approval');
    expect(fromLegacyStatus('awaiting_tool')).toBe('WAITING_FOR_APPROVAL');
    expect(fromLegacyStatus('needs_review')).toBe('BLOCKED');
  });
});

describe('deterministic risk routing', () => {
  it('routes low-risk allowlisted work automatically', () => {
    const decision = decideRisk({
      intent: { kind: 'task.list', confidence: 1, calls: [], notes: [], decision: 'SAFE_AUTO' },
      toolName: 'list_tasks',
      args: { status: 'open' },
      policy: policy(),
      capability: { name: 'list_tasks', kind: 'builtin', riskHint: 'low' },
    });
    expect(decision.decision).toBe('SAFE_AUTO');
    expect(decision.risk).toBe('low');
  });

  it('requires exact approval for sensitive or ask-policy work', () => {
    const decision = decideRisk({
      intent: { kind: 'unknown', confidence: 1, calls: [], notes: [], decision: 'NEEDS_AI' },
      toolName: 'mcp__files_read',
      args: { path: '/workspace/report.txt' },
      policy: policy('ask'),
      capability: { name: 'mcp__files_read', kind: 'mcp', riskHint: 'high', sensitive: true },
      policyVersion: 'v17',
    });
    expect(decision.decision).toBe('APPROVAL_REQUIRED');
    expect(decision.risk).toBe('high');
    expect(decision.requiresFreshConfirmation).toBe(true);
    expect(decision.sandboxConstraints).toEqual({});
  });

  it('hard-denies prohibited capabilities and denied policy', () => {
    const base = {
      intent: { kind: 'unknown' as const, confidence: 1, calls: [], notes: [], decision: 'SAFE_AUTO' as const },
      policy: policy(),
    };
    expect(decideRisk({ ...base, toolName: 'eval', args: {} }).decision).toBe('PROHIBITED');
    expect(decideRisk({ ...base, toolName: 'list_tasks', args: {}, policy: policy('deny') }).decision).toBe(
      'PROHIBITED'
    );
  });

  it('binds every operation input into the fingerprint', () => {
    const base = { toolName: 'mcp__files_read', args: { path: '/a.txt' }, policyVersion: 'v17' };
    const fingerprint = operationFingerprint(base);
    expect(operationFingerprint(base)).toBe(fingerprint);
    expect(operationFingerprint({ ...base, args: { path: '/b.txt' } })).not.toBe(fingerprint);
    expect(operationFingerprint({ ...base, policyVersion: 'v18' })).not.toBe(fingerprint);
  });
});

describe('bounded planner', () => {
  it('builds steps with per-step policy risk and dependencies', () => {
    const { plan } = buildPlan({
      goal: 'Read a file after listing tasks',
      calls: [
        { toolName: 'list_tasks', args: {} },
        { toolName: 'mcp__files_read', args: { path: '/a.txt' } },
      ],
      policy: policy(),
      evaluatePolicy: (toolName) => (toolName === 'list_tasks' ? policy() : policy('ask')),
      policyVersion: 'v17',
      catalog: catalog(),
    });

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].decision).toBe('SAFE_AUTO');
    expect(plan.steps[0].dependsOn).toEqual([]);
    expect(plan.steps[1].decision).toBe('APPROVAL_REQUIRED');
    expect(plan.steps[1].dependsOn).toEqual([plan.steps[0].id]);
    expect(planRequiresApproval(plan)).toBe(true);
    expect(planIsProhibited(plan)).toBe(false);
  });

  it('never plans a capability outside the active catalog', () => {
    const { plan, decisions } = buildPlan({
      goal: 'Run guest code',
      calls: [{ toolName: 'unknown_tool', args: {} }],
      policy: policy(),
      catalog: catalog(),
    });
    expect(plan.steps).toHaveLength(0);
    expect(decisions[0].decision).toBe('PROHIBITED');
    expect(planIsProhibited(plan)).toBe(true);
  });
});

describe('verification envelope', () => {
  it('accepts only a canonical verified success envelope', () => {
    const call = {
      toolName: 'create_task',
      args: {},
      rawArguments: '{}',
      content: '{"ok":true}',
      success: true,
      durationMs: 1,
      trace: '',
      verification: unverified('Pending verification.'),
    };
    expect(verifyToolCall(call).verified).toBe(true);
    expect(verifyToolCall({ ...call, content: '{"ok":false,"error":"partial"}' }).status).toBe('failed');
    expect(verifyToolCall({ ...call, content: 'done!' }).status).toBe('unverified');
  });

  it('keeps timeouts uncertain and never completes on weak evidence', () => {
    const timeout = verifyToolCall({
      toolName: 'mcp__files_write',
      args: {},
      rawArguments: '{}',
      content: '',
      success: false,
      error: 'Tool timed out.',
      errorCode: 'TOOL_TIMEOUT',
      durationMs: 1_000,
      trace: '',
      verification: unverified('Pending verification.'),
    });
    expect(timeout.status).toBe('uncertain');
    expect(verificationToState(timeout)).toBe('BLOCKED');
    expect(verificationToState(verificationFailed('failed'))).toBe('FAILED');
    expect(verificationToState(unverified('no envelope'))).toBe('BLOCKED');
    expect(combineVerifications([timeout, { ...timeout, status: 'verified', verified: true }]).status).toBe(
      'uncertain'
    );
  });
});

describe('exact approval binding', () => {
  async function runningTask(): Promise<string> {
    const task = await createAgentTask(db, {
      userId: 1,
      title: 'Sensitive operation',
      status: 'running',
      hybridState: 'RUNNING',
    });
    return task.id;
  }

  it('waits for approval and approves only a matching binding', async () => {
    db = newDb();
    const taskId = await runningTask();
    const bound = makeBinding(taskId);
    const approvalId = await enterApprovalWait({
      db,
      taskId,
      userId: 1,
      binding: bound,
      trace: { traceId: 'trace-approve' },
    });

    expect((await getAgentTask(db, taskId))?.hybridState).toBe('WAITING_FOR_APPROVAL');
    expect((await getAgentTaskApproval(db, approvalId))?.state).toBe('pending');

    const state = await resolveApprovalWait({
      db,
      approvalId,
      taskId,
      userId: 1,
      binding: bound,
      trace: { traceId: 'trace-approve' },
      granted: true,
      permissionRequestId: 'permission-1',
    });
    expect(state).toBe('approved');
    expect((await getAgentTask(db, taskId))?.hybridState).toBe('RUNNING');
    expect((await getAgentTaskApproval(db, approvalId))?.permissionRequestId).toBe('permission-1');
  });

  it('invalidates approval when parameters, scope, resource or policy version drift', async () => {
    db = newDb();
    const taskId = await runningTask();
    const original = makeBinding(taskId);
    const approvalId = await enterApprovalWait({
      db,
      taskId,
      userId: 1,
      binding: original,
      trace: { traceId: 'trace-drift' },
    });

    const changed = {
      ...original,
      operationFingerprint: operationFingerprint({
        toolName: 'mcp__files_read',
        args: { path: '/b.txt' },
        policyVersion: 'v17',
      }),
      resourceKey: '/b.txt',
      policyVersion: 'v18',
    };
    expect(approvalStillMatches(original, changed)).toBe(false);

    const state = await resolveApprovalWait({
      db,
      approvalId,
      taskId,
      userId: 1,
      binding: changed,
      trace: { traceId: 'trace-drift' },
      granted: true,
    });
    expect(state).toBe('invalidated');
    expect((await getAgentTask(db, taskId))?.hybridState).toBe('BLOCKED');
  });

  it('blocks the task when the user denies', async () => {
    db = newDb();
    const taskId = await runningTask();
    const bound = makeBinding(taskId);
    const approvalId = await enterApprovalWait({
      db,
      taskId,
      userId: 1,
      binding: bound,
      trace: { traceId: 'trace-deny' },
    });
    const state = await resolveApprovalWait({
      db,
      approvalId,
      taskId,
      userId: 1,
      binding: bound,
      trace: { traceId: 'trace-deny' },
      granted: false,
    });
    expect(state).toBe('denied');
    expect((await getAgentTask(db, taskId))?.hybridState).toBe('BLOCKED');
  });
});

describe('append-only hybrid audit', () => {
  it('redacts secrets and detects tampering', async () => {
    db = newDb();
    await recordHybridEvent(db, {
      traceId: 'trace-audit',
      taskId: 'task-1',
      userId: 1,
      source: 'test',
      type: 'capability.success',
      payload: { apiKey: 'super-secret-value', toolName: 'list_tasks' },
    });
    await recordHybridEvent(db, {
      traceId: 'trace-audit',
      source: 'test',
      type: 'task.finished',
      payload: { hybridState: 'COMPLETED' },
    });

    const events = await readHybridTrace(db, 'trace-audit');
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events[0].payload)).not.toContain('super-secret-value');
    await expect(verifyHybridTrace(db, 'trace-audit')).resolves.toBe(true);

    db.raw.prepare('UPDATE hybrid_audit_events SET payload = ? WHERE trace_id = ?').run(
      '{"tampered":true}',
      'trace-audit'
    );
    await expect(verifyHybridTrace(db, 'trace-audit')).resolves.toBe(false);
  });
});

describe('hybrid-aware startup recovery', () => {
  async function staleTask(state: HybridTaskState, withAttempt: boolean): Promise<string> {
    const task = await createAgentTask(db, {
      userId: 1,
      title: `Recover ${state}`,
      status: 'running',
      hybridState: state,
    });
    if (withAttempt) {
      await recordAgentTaskAttempt(db, {
        taskId: task.id,
        attempt: 1,
        toolName: 'list_tasks',
        status: 'success',
        startedAt: 1,
      });
    }
    await db.runAsync('UPDATE agent_tasks SET lease_until = ? WHERE id = ?', 1, task.id);
    return task.id;
  }

  it('requeues untouched work, blocks side-effecting work, and never auto-approves', async () => {
    db = newDb();
    const safeId = await staleTask('RUNNING', false);
    const sideEffectId = await staleTask('RUNNING', true);
    const approvalId = await staleTask('WAITING_FOR_APPROVAL', false);
    await createAgentTaskApproval(db, {
      taskId: approvalId,
      stepId: 'step-1',
      userId: 1,
      binding: makeBinding(approvalId),
      operationFingerprint: 'fp-1',
    });

    await createAgentTaskSchedule(db, {
      userId: 1,
      ownerType: 'agent_task',
      ownerId: 'master',
      title: 'Stale schedule',
      nextRunAt: 1,
      idempotencyKey: 'stale-schedule',
    });
    await db.runAsync('UPDATE agent_task_schedules SET lease_until = ?', 1);

    const result = await recoverHybridAgentTasks(db);

    expect(result.requeued).toBe(1);
    expect(result.blocked).toBe(2);
    expect(result.schedules).toBe(1);
    expect((await getAgentTask(db, safeId))?.hybridState).toBe('QUEUED');
    expect((await getAgentTask(db, sideEffectId))?.hybridState).toBe('BLOCKED');
    expect((await getAgentTask(db, approvalId))?.hybridState).toBe('BLOCKED');
    const approvals = await db.getAllAsync<{ state: string }>(
      'SELECT state FROM agent_task_approvals WHERE task_id = ?',
      approvalId
    );
    expect(approvals[0]?.state).toBe('pending');
  });

  it('does not touch active leases', async () => {
    db = newDb();
    const task = await createAgentTask(db, {
      userId: 1,
      title: 'Active',
      status: 'running',
      hybridState: 'RUNNING',
    });
    await db.runAsync(
      'UPDATE agent_tasks SET lease_until = ? WHERE id = ?',
      Date.now() + 60_000,
      task.id
    );
    const result = await recoverHybridAgentTasks(db);
    expect(result.requeued).toBe(0);
    expect(result.blocked).toBe(0);
    expect((await getAgentTask(db, task.id))?.hybridState).toBe('RUNNING');
  });
});
