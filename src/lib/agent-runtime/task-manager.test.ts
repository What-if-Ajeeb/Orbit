import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { hashChain } from './hash';
import {
  appendAgentTaskEvent,
  appendHybridAuditEvent,
  claimAgentTask,
  claimDueAgentTaskSchedules,
  completeAgentTaskSchedule,
  createAgentTask,
  createAgentTaskApproval,
  createAgentTaskSchedule,
  getAgentTask,
  getAgentTaskApproval,
  getAgentTaskSchedule,
  listAgentTaskEvents,
  listAgentTasks,
  listHybridAuditEvents,
  recoverInterruptedAgentTasks,
  recordAgentTaskAttempt,
  updateAgentTaskApproval,
  updateAgentTaskStatus,
  verifyHybridAuditChain,
} from './task-manager';

vi.mock('expo-crypto', () => {
  let counter = 0;
  return { randomUUID: () => `uuid-${++counter}` };
});

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

describe('durable agent task ledger', () => {
  it('reuses an active idempotent task and starts a new one after completion', async () => {
    db = createTestDatabase();

    const first = await createAgentTask(db, {
      userId: 1,
      title: 'Recurring review',
      idempotencyKey: 'review:1',
    });
    const duplicate = await createAgentTask(db, {
      userId: 1,
      title: 'Recurring review',
      idempotencyKey: 'review:1',
    });

    expect(duplicate.id).toBe(first.id);
    expect(await listAgentTasks(db, 1)).toHaveLength(1);

    await updateAgentTaskStatus(db, first.id, 'completed', { finishedAt: Date.now() });
    const next = await createAgentTask(db, {
      userId: 1,
      title: 'Recurring review',
      idempotencyKey: 'review:1',
    });

    expect(next.id).not.toBe(first.id);
  });

  it('grants a single active lease', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, { userId: 1, title: 'Leased work' });

    const claimed = await claimAgentTask(db, task.id, 'worker-a', 60_000);
    const blocked = await claimAgentTask(db, task.id, 'worker-b', 60_000);

    expect(claimed?.status).toBe('running');
    expect(claimed?.leaseOwner).toBe('worker-a');
    expect(blocked).toBeNull();
  });

  it('moves interrupted tasks to needs_review and releases stale schedule leases', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, { userId: 1, title: 'Interrupted' });
    await claimAgentTask(db, task.id, 'crashed-worker', 60_000);
    const schedule = await createAgentTaskSchedule(db, {
      userId: 1,
      ownerType: 'agent_task',
      ownerId: task.id,
      taskId: task.id,
      title: 'Scheduled',
      nextRunAt: Date.now() - 1_000,
      idempotencyKey: 'schedule:stale',
    });

    const past = Date.now() - 120_000;
    db.raw
      .prepare('UPDATE agent_tasks SET lease_until = ?, updated_at = ? WHERE id = ?')
      .run(past, past, task.id);
    db.raw
      .prepare('UPDATE agent_task_schedules SET lease_owner = ?, lease_until = ? WHERE id = ?')
      .run('crashed-worker', past, schedule.id);

    const recovered = await recoverInterruptedAgentTasks(db, { now: Date.now() });
    const recoveredTask = await getAgentTask(db, task.id);

    expect(recovered.tasks).toBe(1);
    expect(recovered.schedules).toBe(1);
    expect(recoveredTask?.status).toBe('needs_review');
    expect(recoveredTask?.error).toMatch(/Interrupted before verification/i);
    expect(recoveredTask?.leaseOwner).toBeNull();
  });

  it('records a hash-chained event history', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, { userId: 1, title: 'Audited' });
    await claimAgentTask(db, task.id, 'worker');

    const events = await listAgentTaskEvents(db, task.id);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_event, index) => index + 1)
    );
    expect(events[1]?.previousHash).toBe(events[0]?.hash);
    expect(new Set(events.map((event) => event.hash)).size).toBe(events.length);
  });

  it('claims a due schedule once and clears the lease on completion', async () => {
    db = createTestDatabase();
    const schedule = await createAgentTaskSchedule(db, {
      userId: 1,
      ownerType: 'agent_task',
      ownerId: 'owner',
      title: 'Due work',
      nextRunAt: Date.now() - 5_000,
      idempotencyKey: 'schedule:due',
    });

    const first = await claimDueAgentTaskSchedules(db, 'worker-a');
    const second = await claimDueAgentTaskSchedules(db, 'worker-b');

    expect(first.map((item) => item.id)).toContain(schedule.id);
    expect(second).toHaveLength(0);

    await completeAgentTaskSchedule(db, schedule.id, {
      nextRunAt: Date.now() + 60_000,
      disable: true,
    });
    const updated = (await db.getFirstAsync<{ enabled: number; lease_owner: string | null }>(
      'SELECT enabled, lease_owner FROM agent_task_schedules WHERE id = ?',
      schedule.id
    ))!;

    expect(updated.enabled).toBe(0);
    expect(updated.lease_owner).toBeNull();
  });

  it('persists hybrid task metadata on create and status updates', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, {
      userId: 1,
      title: 'Hybrid run',
      hybridState: 'PLANNING',
      traceId: 'trace-hybrid',
      plan: { goal: 'ship' },
      risk: { level: 'low' },
    });

    expect(task.hybridState).toBe('PLANNING');
    expect(task.traceId).toBe('trace-hybrid');
    expect(task.plan).toEqual({ goal: 'ship' });
    expect(task.risk).toEqual({ level: 'low' });

    await updateAgentTaskStatus(db, task.id, 'running', {
      hybridState: 'RUNNING',
      traceId: 'trace-updated',
      plan: { goal: 'ship', step: 2 },
      risk: { level: 'medium' },
    });

    const updated = await getAgentTask(db, task.id);
    expect(updated?.hybridState).toBe('RUNNING');
    expect(updated?.traceId).toBe('trace-updated');
    expect(updated?.plan).toEqual({ goal: 'ship', step: 2 });
    expect(updated?.risk).toEqual({ level: 'medium' });
  });

  it('keeps the legacy event hash shape and stores hybrid event fields', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, { userId: 1, title: 'Legacy hash' });
    const created = (await listAgentTaskEvents(db, task.id))[0];
    if (!created) throw new Error('The created event was not stored.');

    expect(created.traceId).toBeUndefined();
    expect(created.hybridState).toBeUndefined();
    expect(created.hash).toBe(
      hashChain({
        taskId: task.id,
        sequence: created.sequence,
        type: 'task.created',
        payload: { title: 'Legacy hash', kind: 'turn' },
        createdAt: created.createdAt,
        previousHash: '',
      })
    );

    const hybrid = await appendAgentTaskEvent(db, {
      taskId: task.id,
      userId: 1,
      type: 'hybrid.step',
      payload: { step: 'plan' },
      traceId: 'trace-hybrid',
      hybridState: 'PLANNING',
    });
    expect(hybrid.traceId).toBe('trace-hybrid');
    expect(hybrid.hybridState).toBe('PLANNING');
    expect((await listAgentTaskEvents(db, task.id))[1]?.traceId).toBe('trace-hybrid');
  });

  it('records trace linkage on attempts and schedule retries', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, { userId: 1, title: 'Attempted' });

    const attempt = await recordAgentTaskAttempt(db, {
      taskId: task.id,
      attempt: 1,
      toolName: 'echo',
      status: 'success',
      startedAt: 100,
      traceId: 'trace-attempt',
      stepId: 'step-2',
    });
    expect(attempt.traceId).toBe('trace-attempt');
    expect(attempt.stepId).toBe('step-2');

    const schedule = await createAgentTaskSchedule(db, {
      userId: 1,
      ownerType: 'agent_task',
      ownerId: task.id,
      taskId: task.id,
      title: 'Retry',
      nextRunAt: 100,
      idempotencyKey: 'schedule:hybrid',
      traceId: 'trace-schedule',
    });
    expect(schedule.traceId).toBe('trace-schedule');
    expect(schedule.attempt).toBe(0);
    expect(schedule.backoff).toEqual({});

    await completeAgentTaskSchedule(db, schedule.id, {
      completedAt: 200,
      nextRunAt: 300,
      attempt: 2,
      backoff: { delayMs: 500 },
    });

    const row = await db.getFirstAsync<{ attempt: number; backoff_json: string }>(
      'SELECT attempt, backoff_json FROM agent_task_schedules WHERE id = ?',
      schedule.id
    );
    expect(row?.attempt).toBe(2);
    expect(JSON.parse(row?.backoff_json ?? '{}')).toEqual({ delayMs: 500 });
    expect((await getAgentTaskSchedule(db, schedule.id))?.backoff).toEqual({ delayMs: 500 });
  });

  it('stores and resolves approval bindings', async () => {
    db = createTestDatabase();
    await db.runAsync('INSERT OR IGNORE INTO users (id, name) VALUES (1, ?)', 'Test User');
    const task = await createAgentTask(db, { userId: 1, title: 'Approval' });
    const binding = {
      taskId: task.id,
      stepId: 'step-1',
      toolName: 'files.read',
      operationFingerprint: 'fp-1',
      scopeKey: 'scope-1',
      resourceKey: 'resource-1',
      policyVersion: 'v1',
      requestedAt: 10,
    };

    const approval = await createAgentTaskApproval(db, {
      taskId: task.id,
      stepId: 'step-1',
      userId: 1,
      binding,
      operationFingerprint: 'fp-1',
      policyVersion: 'v1',
      createdAt: 10,
    });
    expect(approval.state).toBe('pending');
    expect(JSON.parse(approval.binding)).toEqual(binding);
    expect(approval.policyVersion).toBe('v1');

    const resolved = await updateAgentTaskApproval(db, approval.id, {
      state: 'approved',
      resolvedAt: 20,
    });
    expect(resolved?.state).toBe('approved');
    expect(resolved?.resolvedAt).toBe(20);
    expect((await getAgentTaskApproval(db, approval.id))?.state).toBe('approved');
  });

  it('verifies and detects tampering in the hybrid audit chain', async () => {
    db = createTestDatabase();
    const task = await createAgentTask(db, { userId: 1, title: 'Audited hybrid' });

    const first = await appendHybridAuditEvent(db, {
      traceId: 'trace-audit',
      taskId: task.id,
      userId: 1,
      source: 'planner',
      type: 'plan.created',
      payload: { steps: 2 },
      createdAt: 100,
    });
    const second = await appendHybridAuditEvent(db, {
      traceId: 'trace-audit',
      taskId: task.id,
      userId: 1,
      source: 'executor',
      type: 'step.done',
      payload: { step: 1 },
      createdAt: 101,
    });
    if (first.id === undefined) throw new Error('The audit event was not stored.');

    expect(second.previousHash).toBe(first.hash);
    const events = await listHybridAuditEvents(db, 'trace-audit');
    expect(events.map((event) => event.type)).toEqual(['plan.created', 'step.done']);
    expect(events[0]?.payload).toEqual({ steps: 2 });
    expect(await verifyHybridAuditChain(db, 'trace-audit')).toBe(true);

    db.raw
      .prepare('UPDATE hybrid_audit_events SET payload = ? WHERE id = ?')
      .run('{"steps":3}', first.id);
    expect(await verifyHybridAuditChain(db, 'trace-audit')).toBe(false);
  });
});
