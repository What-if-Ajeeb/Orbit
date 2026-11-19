import type { SQLiteDatabase } from 'expo-sqlite';

import { formatDue, formatTime } from '../dates';
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../tasks';
import type { LlmToolDefinition } from './types';

function timestampToIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function serializeTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    due_at: timestampToIso(task.dueAt),
    due_label: task.dueAt ? formatDue(task.dueAt) : null,
    remind_at: timestampToIso(task.remindAt),
    remind_label: task.remindAt ? formatDue(task.remindAt) : null,
    reminder_scheduled: Boolean(task.notificationId),
    priority: task.priority,
    status: task.status,
  };
}

const LOCAL_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Models sometimes append a Z or an offset to an ISO timestamp. Orbit works in
 * the device's local wall-clock time, so a trailing zone is ignored instead of
 * silently shifting the reminder by a few hours.
 */
function parseLocalDateTime(text: string): number | null {
  const match = text.match(LOCAL_DATE_TIME);

  if (!match) {
    return null;
  }

  const parsed = Date.parse(`${match[1]}T${match[2]}:${match[3] ?? '00'}`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** undefined = invalid value, null = explicitly cleared, number = valid ms. */
function parseTimestamp(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  if (/^\d{10}$/.test(text) || /^\d{13}$/.test(text)) {
    return parseTimestamp(Number(text));
  }

  // A bare date means 9am local time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = Date.parse(`${text}T09:00:00`);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  const local = parseLocalDateTime(text);

  if (local !== null) {
    return local;
  }

  const parsed = Date.parse(text.includes(' ') && !text.includes('T') ? text.replace(' ', 'T') : text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function ok(content: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...content });
}

function fail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

export type ToolExecution = {
  content: string;
  /** Short human-readable description for the chat transcript. Empty = no chip. */
  trace: string;
};

function mutationTrace(action: string, task: Task): string {
  const when = task.remindAt ?? task.dueAt;
  const reminder = task.notificationId && when ? ` · reminder ${formatTime(when)}` : '';
  return `${action} “${task.title}”${reminder}`;
}

export const AGENT_TOOLS: LlmToolDefinition[] = [
  {
    name: 'create_task',
    description:
      'Create a task for the user. Set due_at for a deadline and remind_at when the user asks to be reminded. A reminder is delivered as a local notification at remind_at.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, action-oriented task title.' },
        notes: { type: 'string', description: 'Optional extra details.' },
        due_at: {
          type: 'string',
          description:
            'Deadline as ISO 8601 local time, e.g. 2026-11-20T18:00:00. If only a date is known, use 09:00.',
        },
        remind_at: {
          type: 'string',
          description:
            'When to notify the user, ISO 8601 local time. Only set when the user asks for a reminder.',
        },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description:
      'List the user’s tasks. Use this before updating or completing a task when you do not know its id.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'all'] },
        limit: { type: 'integer', description: 'Max tasks to return (1-50).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done. Requires the task id from list_tasks.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: 'The task id.' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description:
      'Update a task. Omit a field to keep it unchanged; pass null for due_at or remind_at to clear it.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: 'The task id.' },
        title: { type: 'string' },
        notes: { type: 'string' },
        due_at: { type: 'string', description: 'ISO 8601 local time, or null to clear.' },
        remind_at: { type: 'string', description: 'ISO 8601 local time, or null to clear.' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        status: { type: 'string', enum: ['open', 'done'] },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task and its scheduled reminder.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: 'The task id.' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
];

export async function executeTool(
  db: SQLiteDatabase,
  userId: number,
  name: string,
  rawArguments: string
): Promise<ToolExecution> {
  let args: Record<string, unknown>;

  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown;
    args =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    return { content: fail('Arguments must be a JSON object.'), trace: '' };
  }

  switch (name) {
    case 'create_task': {
      const title = asString(args.title).trim();

      if (!title) {
        return { content: fail('title is required.'), trace: '' };
      }

      const dueAt = parseTimestamp(args.due_at);
      const remindAt = parseTimestamp(args.remind_at);

      if (dueAt === undefined) {
        return { content: fail('due_at must be ISO 8601 local time.'), trace: '' };
      }

      if (remindAt === undefined) {
        return { content: fail('remind_at must be ISO 8601 local time.'), trace: '' };
      }

      const priority = asString(args.priority) as TaskPriority;
      const task = await createTask(db, userId, {
        title,
        notes: asString(args.notes) || null,
        dueAt,
        remindAt,
        priority: priority === 'low' || priority === 'high' ? priority : 'normal',
      });

      return {
        content: ok({ task: serializeTask(task) }),
        trace: mutationTrace('Created', task),
      };
    }

    case 'list_tasks': {
      const requestedStatus = asString(args.status);
      const status: TaskStatus | 'all' =
        requestedStatus === 'done' || requestedStatus === 'all' ? requestedStatus : 'open';
      const limit = Math.min(Math.max(asInteger(args.limit) ?? 20, 1), 50);
      const tasks = await listTasks(db, userId, { status, limit });

      return {
        content: ok({ count: tasks.length, status, tasks: tasks.map(serializeTask) }),
        trace: '',
      };
    }

    case 'complete_task': {
      const taskId = asInteger(args.task_id);

      if (taskId === null) {
        return { content: fail('task_id is required.'), trace: '' };
      }

      const task = await completeTask(db, userId, taskId);
      return {
        content: ok({ task: serializeTask(task) }),
        trace: mutationTrace('Completed', task),
      };
    }

    case 'update_task': {
      const taskId = asInteger(args.task_id);

      if (taskId === null) {
        return { content: fail('task_id is required.'), trace: '' };
      }

      const patch: Parameters<typeof updateTask>[3] = {};

      if (typeof args.title === 'string') {
        patch.title = args.title;
      }

      if (args.notes !== undefined) {
        patch.notes = asString(args.notes) || null;
      }

      if (args.due_at !== undefined) {
        const dueAt = parseTimestamp(args.due_at);

        if (dueAt === undefined) {
          return { content: fail('due_at must be ISO 8601 local time or null.'), trace: '' };
        }

        patch.dueAt = dueAt;
      }

      if (args.remind_at !== undefined) {
        const remindAt = parseTimestamp(args.remind_at);

        if (remindAt === undefined) {
          return {
            content: fail('remind_at must be ISO 8601 local time or null.'),
            trace: '',
          };
        }

        patch.remindAt = remindAt;
      }

      if (args.priority === 'low' || args.priority === 'normal' || args.priority === 'high') {
        patch.priority = args.priority;
      }

      if (args.status === 'open' || args.status === 'done') {
        patch.status = args.status;
      }

      const task = await updateTask(db, userId, taskId, patch);
      return {
        content: ok({ task: serializeTask(task) }),
        trace: mutationTrace('Updated', task),
      };
    }

    case 'delete_task': {
      const taskId = asInteger(args.task_id);

      if (taskId === null) {
        return { content: fail('task_id is required.'), trace: '' };
      }

      const matching = await getTask(db, userId, taskId);

      await deleteTask(db, userId, taskId);

      return {
        content: ok({ deleted: taskId }),
        trace: matching ? `Deleted “${matching.title}”` : 'Deleted task',
      };
    }

    default:
      return { content: fail(`Unknown tool: ${name}`), trace: '' };
  }
}
