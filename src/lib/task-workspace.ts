import type { AgentTask, AgentTaskStatus } from './agent-runtime/types';
import type { Task } from './tasks';

export type TaskWorkspaceTab = 'active' | 'up-next';
export type TaskSortMode = 'recent' | 'title' | 'priority';
export type TaskGroupId = 'ready-for-review' | 'needs-input' | 'working' | 'resolved';
export type TaskTone = 'success' | 'warning' | 'blue' | 'neutral';

export const TASK_SORT_MODES: readonly TaskSortMode[] = ['recent', 'title', 'priority'];

export const TASK_GROUP_META: Record<
  TaskGroupId,
  { title: string; tone: TaskTone; collapsible: boolean }
> = {
  'ready-for-review': { title: 'Ready for review', tone: 'success', collapsible: false },
  'needs-input': { title: 'Needs input', tone: 'warning', collapsible: false },
  working: { title: 'Working', tone: 'blue', collapsible: false },
  resolved: { title: 'Resolved', tone: 'neutral', collapsible: true },
};

export const TASK_GROUP_ORDER: readonly TaskGroupId[] = [
  'ready-for-review',
  'needs-input',
  'working',
  'resolved',
];

const STATUS_GROUP: Record<AgentTaskStatus, TaskGroupId> = {
  needs_review: 'ready-for-review',
  awaiting_approval: 'needs-input',
  awaiting_tool: 'needs-input',
  blocked: 'needs-input',
  paused: 'needs-input',
  queued: 'working',
  running: 'working',
  unknown: 'working',
  completed: 'resolved',
  failed: 'resolved',
  cancelled: 'resolved',
};

const STATUS_LABEL: Record<AgentTaskStatus, string> = {
  needs_review: 'Ready for review',
  awaiting_approval: 'Needs approval',
  awaiting_tool: 'Needs a tool',
  blocked: 'Blocked',
  paused: 'Paused',
  queued: 'Queued',
  running: 'Working',
  unknown: 'Working',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function groupForStatus(status: AgentTaskStatus): TaskGroupId {
  return STATUS_GROUP[status] ?? 'working';
}

export function statusLabel(status: AgentTaskStatus): string {
  return STATUS_LABEL[status] ?? 'Working';
}

export function toneForStatus(status: AgentTaskStatus): TaskTone {
  return TASK_GROUP_META[groupForStatus(status)].tone;
}

function stringField(value: unknown, limit = 180): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

/** Descriptions are derived from real task fields; no sample copy is invented. */
export function describeAgentTask(task: AgentTask): string {
  const error = stringField(task.error, 240);

  switch (task.status) {
    case 'awaiting_approval':
      return 'Waiting for your approval before Orbit can continue.';
    case 'awaiting_tool': {
      const tool = stringField(task.input.toolName) ?? stringField(task.input.stepId);
      return tool ? `Waiting for the ${tool} tool to finish.` : 'Waiting for a tool to finish.';
    }
    case 'blocked':
      return error ?? 'Orbit needs your input to continue.';
    case 'paused':
      return 'Paused. Open the conversation to resume this task.';
    case 'needs_review':
      return stringField(task.verification?.reason, 240) ?? 'Review the result before it is finalized.';
    case 'running':
      return `Working in the ${task.phase} phase · attempt ${task.attempts}.`;
    case 'queued':
      return 'Queued and waiting for an available worker.';
    case 'completed':
      return stringField(task.verification?.reason, 240) ?? 'Finished without additional notes.';
    case 'failed':
      return error ?? 'The task failed. Open it for details.';
    case 'cancelled':
      return 'This task was cancelled.';
    default:
      return error ?? 'Status is unavailable. Open the task for details.';
  }
}

function matchesQuery(query: string, ...values: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLocaleLowerCase();

  if (!needle) {
    return true;
  }

  return values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

function compareBySort(a: AgentTask, b: AgentTask, sort: TaskSortMode): number {
  if (sort === 'title') {
    return a.title.localeCompare(b.title);
  }

  if (sort === 'priority') {
    const priority = b.priority - a.priority;
    return priority !== 0 ? priority : b.updatedAt - a.updatedAt;
  }

  return b.updatedAt - a.updatedAt;
}

export type TaskGroup = {
  id: TaskGroupId;
  title: string;
  tone: TaskTone;
  collapsible: boolean;
  count: number;
  tasks: AgentTask[];
};

export function buildTaskGroups(
  tasks: AgentTask[],
  options: { query?: string; sort?: TaskSortMode } = {}
): TaskGroup[] {
  const query = options.query ?? '';
  const sort = options.sort ?? 'recent';
  const filtered = tasks
    .filter((task) => matchesQuery(query, task.title, describeAgentTask(task), task.status))
    .sort((a, b) => compareBySort(a, b, sort));

  return TASK_GROUP_ORDER.map((id) => {
    const meta = TASK_GROUP_META[id];
    const grouped = filtered.filter((task) => groupForStatus(task.status) === id);

    return {
      id,
      title: meta.title,
      tone: meta.tone,
      collapsible: meta.collapsible,
      count: grouped.length,
      tasks: grouped,
    };
  });
}

export function filterPersonalTasks(
  tasks: Task[],
  query = '',
  sort: TaskSortMode = 'recent'
): Task[] {
  const filtered = tasks.filter((task) =>
    matchesQuery(query, task.title, task.notes, task.status)
  );

  return filtered.sort((a, b) => {
    if (sort === 'title') {
      return a.title.localeCompare(b.title);
    }

    if (sort === 'priority') {
      const weight = { high: 2, normal: 1, low: 0 } as const;
      const priority = weight[b.priority] - weight[a.priority];
      return priority !== 0 ? priority : b.updatedAt - a.updatedAt;
    }

    return b.updatedAt - a.updatedAt;
  });
}

type TaskWorkspaceMemoryState = {
  tab: TaskWorkspaceTab;
  sort: TaskSortMode;
  query: string;
  resolvedExpanded: boolean;
  scroll: Record<TaskWorkspaceTab, number>;
  selectedTaskId: string | null;
};

const DEFAULT_MEMORY: TaskWorkspaceMemoryState = {
  tab: 'active',
  sort: 'recent',
  query: '',
  resolvedExpanded: false,
  scroll: { active: 0, 'up-next': 0 },
  selectedTaskId: null,
};

let memory: TaskWorkspaceMemoryState = { ...DEFAULT_MEMORY, scroll: { ...DEFAULT_MEMORY.scroll } };

/**
 * In-memory state survives the Stack push into task detail, including scroll,
 * tab, search and sort. It is deliberately not persisted to disk: task filters
 * are navigation state, not user data.
 */
export function getTaskWorkspaceState(): TaskWorkspaceMemoryState {
  return { ...memory, scroll: { ...memory.scroll } };
}

type TaskWorkspacePatch = Partial<Omit<TaskWorkspaceMemoryState, 'scroll'>> & {
  scroll?: Partial<Record<TaskWorkspaceTab, number>>;
};

export function updateTaskWorkspaceState(patch: TaskWorkspacePatch): void {
  memory = {
    ...memory,
    ...patch,
    scroll: patch.scroll ? { ...memory.scroll, ...patch.scroll } : { ...memory.scroll },
  };
}

export function resetTaskWorkspaceState(): void {
  memory = { ...DEFAULT_MEMORY, scroll: { ...DEFAULT_MEMORY.scroll } };
}
