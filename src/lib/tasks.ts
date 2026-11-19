import type { SQLiteDatabase } from 'expo-sqlite';

import {
  cancelTaskReminder,
  requestNotificationPermission,
  scheduleTaskReminder,
} from './notifications';

export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskStatus = 'open' | 'done';

export type Task = {
  id: number;
  userId: number;
  title: string;
  notes: string | null;
  dueAt: number | null;
  remindAt: number | null;
  priority: TaskPriority;
  status: TaskStatus;
  notificationId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type TaskRow = {
  id: number;
  user_id: number;
  title: string;
  notes: string | null;
  due_at: number | null;
  remind_at: number | null;
  priority: string;
  status: string;
  notification_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskError';
  }
}

function normalizePriority(value: string | null | undefined): TaskPriority {
  return value === 'low' || value === 'high' ? value : 'normal';
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    dueAt: row.due_at,
    remindAt: row.remind_at,
    priority: normalizePriority(row.priority),
    status: row.status === 'done' ? 'done' : 'open',
    notificationId: row.notification_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const TASK_COLUMNS = `
  id, user_id, title, notes, due_at, remind_at, priority, status,
  notification_id, created_at, updated_at, completed_at
`;

export async function getTask(
  db: SQLiteDatabase,
  userId: number,
  taskId: number
): Promise<Task | null> {
  const row = await db.getFirstAsync<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ? AND user_id = ?`,
    taskId,
    userId
  );

  return row ? toTask(row) : null;
}

export type ListTasksOptions = {
  status?: TaskStatus | 'all';
  limit?: number;
};

export async function listTasks(
  db: SQLiteDatabase,
  userId: number,
  options: ListTasksOptions = {}
): Promise<Task[]> {
  const status = options.status ?? 'open';
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const statusClause = status === 'all' ? '' : 'AND status = ?';
  const params: (string | number)[] = status === 'all' ? [userId] : [userId, status];

  const rows = await db.getAllAsync<TaskRow>(
    `SELECT ${TASK_COLUMNS}
     FROM tasks
     WHERE user_id = ? ${statusClause}
     ORDER BY
       CASE WHEN status = 'done' THEN 1 ELSE 0 END,
       CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
       due_at ASC,
       created_at DESC
     LIMIT ?`,
    [...params, limit]
  );

  return rows.map(toTask);
}

async function syncReminder(db: SQLiteDatabase, task: Task): Promise<Task> {
  await cancelTaskReminder(task.notificationId);

  const reminderAt = task.remindAt ?? task.dueAt;
  const shouldSchedule =
    task.status === 'open' && reminderAt !== null && reminderAt > Date.now() + 30_000;

  let notificationId: string | null = null;

  if (shouldSchedule) {
    const granted = await requestNotificationPermission();

    if (granted) {
      notificationId = await scheduleTaskReminder(task);
    }
  }

  if (notificationId !== task.notificationId) {
    await db.runAsync(
      'UPDATE tasks SET notification_id = ? WHERE id = ?',
      notificationId,
      task.id
    );
  }

  return { ...task, notificationId };
}

export type CreateTaskInput = {
  title: string;
  notes?: string | null;
  dueAt?: number | null;
  remindAt?: number | null;
  priority?: TaskPriority;
};

export async function createTask(
  db: SQLiteDatabase,
  userId: number,
  input: CreateTaskInput
): Promise<Task> {
  const title = input.title.trim();

  if (!title) {
    throw new TaskError('Task title is required.');
  }

  const now = Date.now();
  const priority = normalizePriority(input.priority);

  const result = await db.runAsync(
    `INSERT INTO tasks
       (user_id, title, notes, due_at, remind_at, priority, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    userId,
    title,
    input.notes?.trim() || null,
    input.dueAt ?? null,
    input.remindAt ?? null,
    priority,
    now,
    now
  );

  const task = await getTask(db, userId, result.lastInsertRowId);

  if (!task) {
    throw new TaskError('Could not save the task.');
  }

  return syncReminder(db, task);
}

export type UpdateTaskInput = {
  title?: string;
  notes?: string | null;
  dueAt?: number | null;
  remindAt?: number | null;
  priority?: TaskPriority;
  status?: TaskStatus;
};

export async function updateTask(
  db: SQLiteDatabase,
  userId: number,
  taskId: number,
  input: UpdateTaskInput
): Promise<Task> {
  const existing = await getTask(db, userId, taskId);

  if (!existing) {
    throw new TaskError('Task not found.');
  }

  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  const now = Date.now();

  if (input.title !== undefined) {
    const title = input.title.trim();

    if (!title) {
      throw new TaskError('Task title cannot be empty.');
    }

    assignments.push('title = ?');
    values.push(title);
  }

  if (input.notes !== undefined) {
    assignments.push('notes = ?');
    values.push(input.notes?.trim() || null);
  }

  if (input.dueAt !== undefined) {
    assignments.push('due_at = ?');
    values.push(input.dueAt);
  }

  if (input.remindAt !== undefined) {
    assignments.push('remind_at = ?');
    values.push(input.remindAt);
  }

  if (input.priority !== undefined) {
    assignments.push('priority = ?');
    values.push(normalizePriority(input.priority));
  }

  if (input.status !== undefined) {
    assignments.push('status = ?', 'completed_at = ?');
    values.push(input.status, input.status === 'done' ? now : null);
  }

  if (assignments.length === 0) {
    return existing;
  }

  assignments.push('updated_at = ?');
  values.push(now, taskId, userId);

  await db.runAsync(
    `UPDATE tasks SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
    values
  );

  const updated = await getTask(db, userId, taskId);

  if (!updated) {
    throw new TaskError('Task not found.');
  }

  return syncReminder(db, updated);
}

export async function completeTask(
  db: SQLiteDatabase,
  userId: number,
  taskId: number
): Promise<Task> {
  return updateTask(db, userId, taskId, { status: 'done' });
}

export async function reopenTask(
  db: SQLiteDatabase,
  userId: number,
  taskId: number
): Promise<Task> {
  return updateTask(db, userId, taskId, { status: 'open' });
}

export async function deleteTask(
  db: SQLiteDatabase,
  userId: number,
  taskId: number
): Promise<void> {
  const existing = await getTask(db, userId, taskId);

  if (!existing) {
    throw new TaskError('Task not found.');
  }

  await cancelTaskReminder(existing.notificationId);
  await db.runAsync('DELETE FROM tasks WHERE id = ? AND user_id = ?', taskId, userId);
}

export type TaskStats = {
  openCount: number;
  doneCount: number;
  dueToday: number;
  overdue: number;
  nextReminderAt: number | null;
};

export async function getTaskStats(
  db: SQLiteDatabase,
  userId: number
): Promise<TaskStats> {
  const now = Date.now();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const row = await db.getFirstAsync<{
    open_count: number | null;
    done_count: number | null;
    due_today: number | null;
    overdue: number | null;
  }>(
    `SELECT
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count,
       SUM(CASE WHEN status = 'open' AND due_at >= ? AND due_at < ? THEN 1 ELSE 0 END) AS due_today,
       SUM(CASE WHEN status = 'open' AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue
     FROM tasks
     WHERE user_id = ?`,
    dayStart.getTime(),
    dayEnd.getTime(),
    now,
    userId
  );

  const next = await db.getFirstAsync<{ next_at: number | null }>(
    `SELECT MIN(COALESCE(remind_at, due_at)) AS next_at
     FROM tasks
     WHERE user_id = ? AND status = 'open' AND COALESCE(remind_at, due_at) > ?`,
    userId,
    now
  );

  return {
    openCount: row?.open_count ?? 0,
    doneCount: row?.done_count ?? 0,
    dueToday: row?.due_today ?? 0,
    overdue: row?.overdue ?? 0,
    nextReminderAt: next?.next_at ?? null,
  };
}
