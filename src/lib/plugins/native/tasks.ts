import {
  completeTask,
  createTask,
  deleteTask,
  getTaskStats,
  listTasks,
  updateTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeOutputSchema,
  nativeTool,
  objectSchema,
  readNumber,
  readString,
} from './helpers';

export const TASKS_PLUGIN_ID = 'orbit.builtin.tasks';

const TITLE_MAX = 200;
const NOTES_MAX = 2_000;

export const tasksManifest: PluginManifest = seedPluginManifest({
  pluginId: TASKS_PLUGIN_ID,
  name: 'ORBIT Tasks',
  version: '1.0.0',
  description:
    'Task list and reminder operations that call the existing task store. Notification sync and buddy rewards stay owned by tasks.ts.',
  category: 'automation',
  icon: 'checkbox-marked-circle-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-tasks' },
  permissions: ['ai.invoke', 'storage.read', 'storage.write'],
  capabilities: ['tools.ai', 'automation.triggers'],
  dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const TASK_FIELDS = {
  id: { type: 'integer' },
  title: { type: 'string' },
  notes: { type: ['string', 'null'] },
  dueAt: { type: ['integer', 'null'] },
  remindAt: { type: ['integer', 'null'] },
  priority: { type: 'string' },
  status: { type: 'string' },
  createdAt: { type: 'integer' },
  updatedAt: { type: 'integer' },
  completedAt: { type: ['integer', 'null'] },
} as const;

const LIST_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  tasks: {
    type: 'array',
    items: {
      type: 'object',
      properties: TASK_FIELDS,
      required: [
        'id',
        'title',
        'notes',
        'dueAt',
        'remindAt',
        'priority',
        'status',
        'createdAt',
        'updatedAt',
        'completedAt',
      ],
      additionalProperties: false,
    },
  },
});

const TASK_OUTPUT_SCHEMA = nativeOutputSchema(TASK_FIELDS);

const STATS_OUTPUT_SCHEMA = nativeOutputSchema({
  openCount: { type: 'integer' },
  doneCount: { type: 'integer' },
  dueToday: { type: 'integer' },
  overdue: { type: 'integer' },
  nextReminderAt: { type: ['integer', 'null'] },
});

function mapTask(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt,
    remindAt: task.remindAt,
    priority: task.priority,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function readPriority(args: Record<string, unknown>): TaskPriority | undefined {
  const value = readString(args, 'priority');

  if (value === undefined) {
    return undefined;
  }

  if (!['low', 'normal', 'high'].includes(value)) {
    throw new Error('priority must be low, normal or high.');
  }

  return value as TaskPriority;
}

function readStatus(args: Record<string, unknown>): TaskStatus | undefined {
  const value = readString(args, 'status');

  if (value === undefined) {
    return undefined;
  }

  if (!['open', 'done'].includes(value)) {
    throw new Error('status must be open or done.');
  }

  return value as TaskStatus;
}

function readOptionalTimestamp(
  args: Record<string, unknown>,
  key: string
): number | null | undefined {
  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return readNumber(args, key, { min: 0 }) ?? undefined;
}

const listTasksTool = nativeTool('tasks_list', {
  name: 'tasks_list',
  description: 'List tasks for the current user, optionally filtered by status.',
  parameters: objectSchema(
    {
      status: { type: 'string', enum: ['open', 'done', 'all'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    []
  ),
  outputSchema: LIST_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(args, context) {
    const status = readString(args, 'status') ?? 'all';
    const limit = readNumber(args, 'limit', { min: 1, max: 100 }) ?? 50;

    if (!['open', 'done', 'all'].includes(status)) {
      throw new Error('status must be open, done or all.');
    }

    const tasks = await listTasks(context.db, context.userId, {
      status: status as TaskStatus | 'all',
      limit,
    });

    return { total: tasks.length, tasks: tasks.map(mapTask) };
  },
});

const statsTool = nativeTool('tasks_stats', {
  name: 'tasks_stats',
  description: 'Report open, done, due-today, overdue and next-reminder counts.',
  parameters: objectSchema({}, []),
  outputSchema: STATS_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(_args, context) {
    return getTaskStats(context.db, context.userId);
  },
});

const createTaskTool = nativeTool('tasks_create', {
  name: 'tasks_create',
  description:
    'Create a task using the existing task store, including reminder scheduling. Requires explicit approval.',
  parameters: objectSchema(
    {
      title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
      notes: { type: 'string', maxLength: NOTES_MAX },
      dueAt: { type: 'integer', minimum: 0 },
      remindAt: { type: 'integer', minimum: 0 },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    },
    ['title']
  ),
  outputSchema: TASK_OUTPUT_SCHEMA,
  permissions: ['storage.write'],
  requiresApproval: true,
  async execute(args, context) {
    const title = readString(args, 'title', {
      required: true,
      maxLength: TITLE_MAX,
    })!;
    const notes = readString(args, 'notes', { maxLength: NOTES_MAX });
    const task = await createTask(context.db, context.userId, {
      title,
      notes,
      dueAt: readOptionalTimestamp(args, 'dueAt'),
      remindAt: readOptionalTimestamp(args, 'remindAt'),
      priority: readPriority(args),
    });

    return mapTask(task);
  },
});

const updateTaskTool = nativeTool('tasks_update', {
  name: 'tasks_update',
  description:
    'Update a task using the existing task store. Completion through this tool preserves buddy rewards and reminder sync. Requires explicit approval.',
  parameters: objectSchema(
    {
      id: { type: 'integer', minimum: 1 },
      title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
      notes: { type: 'string', maxLength: NOTES_MAX },
      dueAt: { type: 'integer', minimum: 0 },
      remindAt: { type: 'integer', minimum: 0 },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      status: { type: 'string', enum: ['open', 'done'] },
    },
    ['id']
  ),
  outputSchema: TASK_OUTPUT_SCHEMA,
  permissions: ['storage.write'],
  requiresApproval: true,
  async execute(args, context) {
    const id = readNumber(args, 'id', { required: true, min: 1 })!;
    const task = await updateTask(context.db, context.userId, id, {
      title: readString(args, 'title', { maxLength: TITLE_MAX }),
      notes: readString(args, 'notes', { maxLength: NOTES_MAX }),
      dueAt: readOptionalTimestamp(args, 'dueAt'),
      remindAt: readOptionalTimestamp(args, 'remindAt'),
      priority: readPriority(args),
      status: readStatus(args),
    });

    return mapTask(task);
  },
});

const completeTaskTool = nativeTool('tasks_complete', {
  name: 'tasks_complete',
  description:
    'Complete a task through the existing task store, preserving its single buddy reward and reminder cancellation. Requires explicit approval.',
  parameters: objectSchema(
    { id: { type: 'integer', minimum: 1 } },
    ['id']
  ),
  outputSchema: TASK_OUTPUT_SCHEMA,
  permissions: ['storage.write'],
  requiresApproval: true,
  async execute(args, context) {
    const id = readNumber(args, 'id', { required: true, min: 1 })!;
    return mapTask(await completeTask(context.db, context.userId, id));
  },
});

const deleteTaskTool = nativeTool('tasks_delete', {
  name: 'tasks_delete',
  description:
    'Delete a task through the existing task store, including reminder cancellation. Requires explicit approval.',
  parameters: objectSchema(
    { id: { type: 'integer', minimum: 1 } },
    ['id']
  ),
  outputSchema: nativeOutputSchema({ removed: { type: 'boolean' } }),
  permissions: ['storage.write'],
  requiresApproval: true,
  async execute(args, context) {
    const id = readNumber(args, 'id', { required: true, min: 1 })!;
    await deleteTask(context.db, context.userId, id);
    return { removed: true };
  },
});

const TASK_TOOLS = [
  listTasksTool,
  statsTool,
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  deleteTaskTool,
];

export const tasksImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.tasks] tasks plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.tasks] tasks plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.tasks] tasks plugin reported an error');
    },
  },
  activate(sdk) {
    for (const tool of TASK_TOOLS) {
      void sdk.tools.register(tool);
    }
  },
};
