import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import {
  claimAgentTask,
  claimDueAgentTaskSchedules,
  completeAgentTaskSchedule,
  createAgentTask,
  createAgentTaskSchedule,
  getAgentTask,
  listAgentTaskEvents,
  listAgentTasks,
  recoverInterruptedAgentTasks,
  updateAgentTaskStatus,
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
});
