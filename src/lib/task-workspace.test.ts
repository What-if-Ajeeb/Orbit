import { describe, expect, it } from 'vitest';

import type { AgentTask, AgentTaskStatus } from './agent-runtime/types';
import {
  TASK_GROUP_ORDER,
  buildTaskGroups,
  describeAgentTask,
  filterPersonalTasks,
  getTaskWorkspaceState,
  groupForStatus,
  resetTaskWorkspaceState,
  statusLabel,
  toneForStatus,
  updateTaskWorkspaceState,
} from './task-workspace';
import type { Task } from './tasks';

function task(id: string, status: AgentTaskStatus, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    userId: 1,
    conversationId: 42,
    projectId: '',
    parentTaskId: null,
    subagentId: null,
    kind: 'turn',
    title: id,
    status,
    phase: 'ai',
    input: {},
    result: null,
    verification: null,
    error: null,
    attempts: 1,
    maxAttempts: 3,
    priority: 0,
    idempotencyKey: null,
    leaseOwner: null,
    leaseUntil: null,
    budget: {},
    grants: [],
    createdAt: 100,
    updatedAt: 100,
    startedAt: null,
    finishedAt: null,
    nextRunAt: null,
    ...overrides,
  };
}

function personal(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    userId: 1,
    title: `Task ${id}`,
    notes: '',
    status: 'open',
    priority: 'normal',
    dueAt: null,
    remindAt: null,
    notificationId: null,
    completedAt: null,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('task workspace grouping', () => {
  it('maps real agent statuses into the four workspace groups', () => {
    expect(groupForStatus('needs_review')).toBe('ready-for-review');
    expect(groupForStatus('awaiting_approval')).toBe('needs-input');
    expect(groupForStatus('awaiting_tool')).toBe('needs-input');
    expect(groupForStatus('blocked')).toBe('needs-input');
    expect(groupForStatus('paused')).toBe('needs-input');
    expect(groupForStatus('queued')).toBe('working');
    expect(groupForStatus('running')).toBe('working');
    expect(groupForStatus('completed')).toBe('resolved');
    expect(groupForStatus('failed')).toBe('resolved');
    expect(groupForStatus('cancelled')).toBe('resolved');
  });

  it('uses warm status tones for review, input and working', () => {
    expect(toneForStatus('needs_review')).toBe('success');
    expect(toneForStatus('blocked')).toBe('warning');
    expect(toneForStatus('running')).toBe('blue');
    expect(statusLabel('needs_review')).toBe('Ready for review');
    expect(statusLabel('awaiting_approval')).toBe('Needs approval');
  });

  it('builds groups in order with real counts and only resolved collapsible', () => {
    const groups = buildTaskGroups([
      task('review', 'needs_review'),
      task('approval', 'awaiting_approval'),
      task('running', 'running'),
      task('done', 'completed', { updatedAt: 100 }),
      task('failed', 'failed', { updatedAt: 300 }),
      task('cancelled', 'cancelled', { updatedAt: 200 }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(TASK_GROUP_ORDER);
    expect(groups.map((group) => group.count)).toEqual([1, 1, 1, 3]);
    expect(groups.filter((group) => group.collapsible).map((group) => group.id)).toEqual([
      'resolved',
    ]);
    expect(groups[3]?.tasks.map((item) => item.id)).toEqual(['failed', 'cancelled', 'done']);
  });

  it('filters by title and derived description without inventing sample tasks', () => {
    const groups = buildTaskGroups(
      [
        task('alpha', 'blocked', { error: 'Waiting on billing approval' }),
        task('beta', 'running'),
      ],
      { query: 'billing' }
    );

    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(1);
    expect(describeAgentTask(task('x', 'blocked', { error: 'Needs an API key' }))).toBe(
      'Needs an API key'
    );
  });

  it('sorts agent tasks by recent activity, title and priority', () => {
    const tasks = [
      task('old', 'running', { updatedAt: 10, priority: 0, title: 'Zebra' }),
      task('new', 'running', { updatedAt: 20, priority: 0, title: 'Apple' }),
      task('urgent', 'running', { updatedAt: 5, priority: 4, title: 'Mango' }),
    ];

    expect(
      buildTaskGroups(tasks, { sort: 'recent' })[2]?.tasks.map((item) => item.id)
    ).toEqual(['new', 'old', 'urgent']);
    expect(
      buildTaskGroups(tasks, { sort: 'title' })[2]?.tasks.map((item) => item.id)
    ).toEqual(['new', 'urgent', 'old']);
    expect(
      buildTaskGroups(tasks, { sort: 'priority' })[2]?.tasks.map((item) => item.id)
    ).toEqual(['urgent', 'new', 'old']);
  });

  it('filters and sorts personal tasks with the same modes', () => {
    const tasks = [
      personal(1, { title: 'Pay bill', updatedAt: 10, priority: 'normal' }),
      personal(2, { title: 'Renew passport', updatedAt: 20, priority: 'high' }),
      personal(3, { title: 'Archive files', updatedAt: 30, priority: 'low' }),
    ];

    expect(filterPersonalTasks(tasks, 'bill').map((item) => item.id)).toEqual([1]);
    expect(filterPersonalTasks(tasks, '', 'priority').map((item) => item.id)).toEqual([2, 1, 3]);
  });
});

describe('task workspace navigation memory', () => {
  it('preserves tab, filters, collapse and scroll across detail navigation', () => {
    resetTaskWorkspaceState();

    updateTaskWorkspaceState({
      tab: 'up-next',
      sort: 'title',
      query: 'passport',
      resolvedExpanded: true,
      scroll: { 'up-next': 240 },
      selectedTaskId: 'task-9',
    });

    const restored = getTaskWorkspaceState();

    expect(restored.tab).toBe('up-next');
    expect(restored.sort).toBe('title');
    expect(restored.query).toBe('passport');
    expect(restored.resolvedExpanded).toBe(true);
    expect(restored.scroll['up-next']).toBe(240);
    expect(restored.scroll.active).toBe(0);
    expect(restored.selectedTaskId).toBe('task-9');

    resetTaskWorkspaceState();
    expect(getTaskWorkspaceState().tab).toBe('active');
    expect(getTaskWorkspaceState().scroll['up-next']).toBe(0);
  });
});
