import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  ApprovalBinding,
  ApprovalState,
  HybridAuditEvent,
  HybridTaskState,
} from '../hybrid-agent/types';

import { hashChain, stableJson } from './hash';
import type {
  AgentBudget,
  AgentTask,
  AgentTaskAttempt,
  AgentTaskEvent,
  AgentTaskKind,
  AgentTaskPhase,
  AgentTaskSchedule,
  AgentTaskStatus,
  AgentTaskVerification,
  CapabilityGrant,
} from './types';

type TaskRow = {
  id: string;
  user_id: number;
  conversation_id: number | null;
  project_id: string;
  parent_task_id: string | null;
  subagent_id: string | null;
  kind: string;
  title: string;
  status: string;
  phase: string;
  input_json: string;
  result_json: string | null;
  verification_json: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  priority: number;
  idempotency_key: string | null;
  lease_owner: string | null;
  lease_until: number | null;
  budget_json: string;
  grants_json: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  next_run_at: number | null;
  hybrid_state: string | null;
  trace_id: string | null;
  plan_json: string;
  risk_json: string;
};

type ScheduleRow = {
  id: string;
  user_id: number;
  owner_type: string;
  owner_id: string;
  task_id: string | null;
  title: string;
  input_json: string;
  enabled: number;
  interval_ms: number | null;
  next_run_at: number;
  last_run_at: number | null;
  lease_owner: string | null;
  lease_until: number | null;
  idempotency_key: string;
  created_at: number;
  updated_at: number;
  trace_id: string | null;
  attempt: number;
  backoff_json: string;
};

type EventRow = {
  id: number;
  task_id: string;
  sequence: number;
  user_id: number;
  type: string;
  payload: string;
  created_at: number;
  previous_hash: string;
  hash: string;
  trace_id: string | null;
  hybrid_state: string | null;
};

type AttemptRow = {
  id: string;
  task_id: string;
  attempt: number;
  tool_name: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  duration_ms: number;
  error_code: string | null;
  error: string | null;
  verification: string | null;
  metadata: string;
  trace_id: string | null;
  step_id: string | null;
};

type ApprovalRow = {
  id: string;
  task_id: string;
  step_id: string;
  user_id: number;
  permission_request_id: string | null;
  binding: string;
  state: string;
  operation_fingerprint: string;
  policy_version: string | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
};

type HybridAuditRow = {
  id: number;
  trace_id: string;
  task_id: string | null;
  user_id: number | null;
  source: string;
  type: string;
  payload: string;
  previous_hash: string;
  hash: string;
  created_at: number;
};

const TASK_COLUMNS = `id, user_id, conversation_id, project_id, parent_task_id, subagent_id,
  kind, title, status, phase, input_json, result_json, verification_json, error,
  attempts, max_attempts, priority, idempotency_key, lease_owner, lease_until,
  budget_json, grants_json, created_at, updated_at, started_at, finished_at, next_run_at,
  hybrid_state, trace_id, plan_json, risk_json`;

const SCHEDULE_COLUMNS = `id, user_id, owner_type, owner_id, task_id, title, input_json,
  enabled, interval_ms, next_run_at, last_run_at, lease_owner, lease_until,
  idempotency_key, created_at, updated_at, trace_id, attempt, backoff_json`;

const EVENT_COLUMNS = `id, task_id, sequence, user_id, type, payload, created_at,
  previous_hash, hash, trace_id, hybrid_state`;

const ATTEMPT_COLUMNS = `id, task_id, attempt, tool_name, status, started_at, finished_at,
  duration_ms, error_code, error, verification, metadata, trace_id, step_id`;

const APPROVAL_COLUMNS = `id, task_id, step_id, user_id, permission_request_id, binding,
  state, operation_fingerprint, policy_version, created_at, updated_at, resolved_at`;

const AUDIT_COLUMNS = `id, trace_id, task_id, user_id, source, type, payload,
  previous_hash, hash, created_at`;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Databases opened before v17 (including in-memory test databases) get the
 * additive hybrid schema on first use. The real migration in db.ts owns the
 * version bump; every statement here is guarded and safe to reapply.
 */
const hybridSchemaReady = new WeakSet<object>();

async function ensureHybridSchema(db: SQLiteDatabase): Promise<void> {
  if (hybridSchemaReady.has(db as object)) return;

  const [taskColumns, eventColumns, attemptColumns, scheduleColumns] = await Promise.all([
    db.getAllAsync<{ name: string }>('PRAGMA table_info(agent_tasks)'),
    db.getAllAsync<{ name: string }>('PRAGMA table_info(agent_task_events)'),
    db.getAllAsync<{ name: string }>('PRAGMA table_info(agent_task_attempts)'),
    db.getAllAsync<{ name: string }>('PRAGMA table_info(agent_task_schedules)'),
  ]);
  const has = (columns: { name: string }[], name: string): boolean =>
    columns.some((column) => column.name === name);

  const statements = [
    `CREATE TABLE IF NOT EXISTS agent_task_approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      permission_request_id TEXT,
      binding TEXT NOT NULL,
      state TEXT NOT NULL,
      operation_fingerprint TEXT NOT NULL,
      policy_version TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS hybrid_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      task_id TEXT,
      user_id INTEGER,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      previous_hash TEXT NOT NULL DEFAULT '',
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ];

  if (!has(taskColumns, 'hybrid_state')) {
    statements.push('ALTER TABLE agent_tasks ADD COLUMN hybrid_state TEXT');
  }
  if (!has(taskColumns, 'trace_id')) {
    statements.push('ALTER TABLE agent_tasks ADD COLUMN trace_id TEXT');
  }
  if (!has(taskColumns, 'plan_json')) {
    statements.push(`ALTER TABLE agent_tasks ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!has(taskColumns, 'risk_json')) {
    statements.push(`ALTER TABLE agent_tasks ADD COLUMN risk_json TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!has(eventColumns, 'trace_id')) {
    statements.push('ALTER TABLE agent_task_events ADD COLUMN trace_id TEXT');
  }
  if (!has(eventColumns, 'hybrid_state')) {
    statements.push('ALTER TABLE agent_task_events ADD COLUMN hybrid_state TEXT');
  }
  if (!has(attemptColumns, 'trace_id')) {
    statements.push('ALTER TABLE agent_task_attempts ADD COLUMN trace_id TEXT');
  }
  if (!has(attemptColumns, 'step_id')) {
    statements.push('ALTER TABLE agent_task_attempts ADD COLUMN step_id TEXT');
  }
  if (!has(scheduleColumns, 'trace_id')) {
    statements.push('ALTER TABLE agent_task_schedules ADD COLUMN trace_id TEXT');
  }
  if (!has(scheduleColumns, 'attempt')) {
    statements.push(
      'ALTER TABLE agent_task_schedules ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0'
    );
  }
  if (!has(scheduleColumns, 'backoff_json')) {
    statements.push(
      `ALTER TABLE agent_task_schedules ADD COLUMN backoff_json TEXT NOT NULL DEFAULT '{}'`
    );
  }

  await db.execAsync(statements.join(';\n'));
  hybridSchemaReady.add(db as object);
}

function rowToTask(row: TaskRow): AgentTask {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    parentTaskId: row.parent_task_id,
    subagentId: row.subagent_id,
    kind: row.kind as AgentTaskKind,
    title: row.title,
    status: row.status as AgentTaskStatus,
    phase: row.phase as AgentTaskPhase,
    input: parseJson(row.input_json, {}),
    result: row.result_json ? parseJson(row.result_json, {}) : null,
    verification: row.verification_json
      ? parseJson<AgentTaskVerification | null>(row.verification_json, null)
      : null,
    error: row.error,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    priority: row.priority,
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    budget: parseJson<AgentBudget>(row.budget_json, {}),
    grants: parseJson<CapabilityGrant[]>(row.grants_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    nextRunAt: row.next_run_at,
    hybridState: (row.hybrid_state as HybridTaskState | null) ?? undefined,
    traceId: row.trace_id ?? undefined,
    plan: parseJson<Record<string, unknown>>(row.plan_json, {}),
    risk: parseJson<Record<string, unknown>>(row.risk_json, {}),
  };
}

function rowToSchedule(row: ScheduleRow): AgentTaskSchedule {
  return {
    id: row.id,
    userId: row.user_id,
    ownerType: row.owner_type as AgentTaskSchedule['ownerType'],
    ownerId: row.owner_id,
    taskId: row.task_id,
    title: row.title,
    input: parseJson(row.input_json, {}),
    enabled: row.enabled === 1,
    intervalMs: row.interval_ms,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    traceId: row.trace_id ?? undefined,
    attempt: row.attempt ?? 0,
    backoff: parseJson<Record<string, unknown>>(row.backoff_json, {}),
  };
}

function rowToEvent(row: EventRow): AgentTaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    sequence: row.sequence,
    userId: row.user_id,
    type: row.type,
    payload: parseJson(row.payload, {}),
    createdAt: row.created_at,
    previousHash: row.previous_hash,
    hash: row.hash,
    traceId: row.trace_id ?? undefined,
    hybridState: (row.hybrid_state as HybridTaskState | null) ?? undefined,
  };
}

function rowToAttempt(row: AttemptRow): AgentTaskAttempt {
  return {
    id: row.id,
    taskId: row.task_id,
    attempt: row.attempt,
    toolName: row.tool_name,
    status: row.status as AgentTaskAttempt['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    error: row.error,
    verification: row.verification ? parseJson(row.verification, null) : null,
    metadata: parseJson(row.metadata, {}),
    traceId: row.trace_id ?? undefined,
    stepId: row.step_id ?? undefined,
  };
}

export type AgentTaskApproval = {
  id: string;
  taskId: string;
  stepId: string;
  userId: number;
  permissionRequestId: string | null;
  /** Serialized ApprovalBinding; callers parse it before comparing bindings. */
  binding: string;
  state: ApprovalState;
  operationFingerprint: string;
  policyVersion: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
};

function rowToApproval(row: ApprovalRow): AgentTaskApproval {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    userId: row.user_id,
    permissionRequestId: row.permission_request_id,
    binding: row.binding,
    state: row.state as ApprovalState,
    operationFingerprint: row.operation_fingerprint,
    policyVersion: row.policy_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function rowToHybridAuditEvent(row: HybridAuditRow): HybridAuditEvent {
  return {
    id: row.id,
    traceId: row.trace_id,
    taskId: row.task_id,
    userId: row.user_id,
    source: row.source,
    type: row.type,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    previousHash: row.previous_hash,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

export function newAgentTaskId(prefix = 'agent_task'): string {
  return `${prefix}_${Crypto.randomUUID()}`;
}

export async function createAgentTask(
  db: SQLiteDatabase,
  input: {
    userId: number;
    conversationId?: number | null;
    projectId?: string;
    parentTaskId?: string | null;
    subagentId?: string | null;
    kind?: AgentTaskKind;
    title: string;
    input?: Record<string, unknown>;
    budget?: AgentBudget;
    grants?: CapabilityGrant[];
    maxAttempts?: number;
    priority?: number;
    idempotencyKey?: string;
    nextRunAt?: number | null;
    status?: AgentTaskStatus;
    hybridState?: HybridTaskState;
    traceId?: string;
    plan?: Record<string, unknown>;
    risk?: Record<string, unknown>;
  }
): Promise<AgentTask> {
  await ensureHybridSchema(db);
  const now = Date.now();

  if (input.idempotencyKey) {
    const existing = (await db.getFirstAsync(
      `SELECT ${TASK_COLUMNS} FROM agent_tasks
       WHERE user_id = ? AND idempotency_key = ?
         AND status NOT IN ('completed', 'failed', 'cancelled', 'needs_review', 'unknown')
       ORDER BY created_at DESC LIMIT 1`,
      input.userId,
      input.idempotencyKey
    )) as TaskRow | null;

    if (existing) return rowToTask(existing);
  }

  const id = newAgentTaskId();
  await db.runAsync(
    `INSERT INTO agent_tasks (
      id, user_id, conversation_id, project_id, parent_task_id, subagent_id, kind,
      title, status, phase, input_json, result_json, verification_json, error,
      attempts, max_attempts, priority, idempotency_key, lease_owner, lease_until,
      budget_json, grants_json, created_at, updated_at, started_at, finished_at, next_run_at,
      hybrid_state, trace_id, plan_json, risk_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, NULL, NULL, NULL,
      0, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    id,
    input.userId,
    input.conversationId ?? null,
    input.projectId ?? 'orbit-workspace',
    input.parentTaskId ?? null,
    input.subagentId ?? null,
    input.kind ?? 'turn',
    input.title,
    input.status ?? 'queued',
    stableJson(input.input ?? {}),
    Math.max(1, Math.min(10, input.maxAttempts ?? 2)),
    input.priority ?? 0,
    input.idempotencyKey ?? null,
    stableJson(input.budget ?? {}),
    stableJson(input.grants ?? []),
    now,
    now,
    input.nextRunAt ?? null,
    input.hybridState ?? null,
    input.traceId ?? null,
    stableJson(input.plan ?? {}),
    stableJson(input.risk ?? {})
  );

  await appendAgentTaskEvent(db, {
    taskId: id,
    userId: input.userId,
    type: 'task.created',
    payload: { title: input.title, kind: input.kind ?? 'turn' },
    traceId: input.traceId,
    hybridState: input.hybridState,
  });

  const task = await getAgentTask(db, id);
  if (!task) throw new Error('The agent task could not be read back.');
  return task;
}

export async function getAgentTask(
  db: SQLiteDatabase,
  id: string
): Promise<AgentTask | null> {
  await ensureHybridSchema(db);
  const row = (await db.getFirstAsync(
    `SELECT ${TASK_COLUMNS} FROM agent_tasks WHERE id = ?`,
    id
  )) as TaskRow | null;
  return row ? rowToTask(row) : null;
}

export async function listAgentTasks(
  db: SQLiteDatabase,
  userId: number,
  limit = 100
): Promise<AgentTask[]> {
  await ensureHybridSchema(db);
  const rows = (await db.getAllAsync(
    `SELECT ${TASK_COLUMNS} FROM agent_tasks
     WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    Math.max(1, Math.min(500, limit))
  )) as TaskRow[];
  return rows.map(rowToTask);
}

export async function claimAgentTask(
  db: SQLiteDatabase,
  id: string,
  owner: string,
  leaseMs = 60_000
): Promise<AgentTask | null> {
  await ensureHybridSchema(db);
  const now = Date.now();
  const result = await db.runAsync(
    `UPDATE agent_tasks
     SET status = 'running',
         lease_owner = ?,
         lease_until = ?,
         started_at = COALESCE(started_at, ?),
         updated_at = ?
     WHERE id = ?
       AND (status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until <= ?)))`,
    owner,
    now + leaseMs,
    now,
    now,
    id,
    now
  );

  if (result.changes === 0) return null;
  const task = await getAgentTask(db, id);
  if (task) {
    await appendAgentTaskEvent(db, {
      taskId: id,
      userId: task.userId,
      type: 'task.claimed',
      payload: { owner, leaseUntil: now + leaseMs },
    });
  }
  return task;
}

type TaskStatusPatch = {
  phase?: AgentTaskPhase;
  result?: Record<string, unknown> | null;
  verification?: AgentTaskVerification | null;
  error?: string | null;
  finishedAt?: number | null;
  nextRunAt?: number | null;
  leaseOwner?: string | null;
  leaseUntil?: number | null;
  attempts?: number;
  hybridState?: HybridTaskState;
  traceId?: string;
  plan?: Record<string, unknown>;
  risk?: Record<string, unknown>;
};

export async function updateAgentTaskStatus(
  db: SQLiteDatabase,
  id: string,
  status: AgentTaskStatus,
  patch: TaskStatusPatch = {}
): Promise<void> {
  await ensureHybridSchema(db);
  const now = Date.now();
  await db.runAsync(
    `UPDATE agent_tasks SET
      status = ?,
      phase = COALESCE(?, phase),
      result_json = CASE WHEN ? = 1 THEN ? ELSE result_json END,
      verification_json = CASE WHEN ? = 1 THEN ? ELSE verification_json END,
      error = CASE WHEN ? = 1 THEN ? ELSE error END,
      finished_at = CASE WHEN ? = 1 THEN ? ELSE finished_at END,
      next_run_at = CASE WHEN ? = 1 THEN ? ELSE next_run_at END,
      lease_owner = CASE WHEN ? = 1 THEN ? ELSE lease_owner END,
      lease_until = CASE WHEN ? = 1 THEN ? ELSE lease_until END,
      attempts = CASE WHEN ? = 1 THEN ? ELSE attempts END,
      hybrid_state = CASE WHEN ? = 1 THEN ? ELSE hybrid_state END,
      trace_id = CASE WHEN ? = 1 THEN ? ELSE trace_id END,
      plan_json = CASE WHEN ? = 1 THEN ? ELSE plan_json END,
      risk_json = CASE WHEN ? = 1 THEN ? ELSE risk_json END,
      updated_at = ?
     WHERE id = ?`,
    status,
    patch.phase ?? null,
    patch.result !== undefined ? 1 : 0,
    patch.result !== undefined ? stableJson(patch.result) : null,
    patch.verification !== undefined ? 1 : 0,
    patch.verification !== undefined ? stableJson(patch.verification) : null,
    patch.error !== undefined ? 1 : 0,
    patch.error !== undefined ? patch.error : null,
    patch.finishedAt !== undefined ? 1 : 0,
    patch.finishedAt !== undefined ? patch.finishedAt : null,
    patch.nextRunAt !== undefined ? 1 : 0,
    patch.nextRunAt !== undefined ? patch.nextRunAt : null,
    patch.leaseOwner !== undefined ? 1 : 0,
    patch.leaseOwner !== undefined ? patch.leaseOwner : null,
    patch.leaseUntil !== undefined ? 1 : 0,
    patch.leaseUntil !== undefined ? patch.leaseUntil : null,
    patch.attempts !== undefined ? 1 : 0,
    patch.attempts !== undefined ? patch.attempts : null,
    patch.hybridState !== undefined ? 1 : 0,
    patch.hybridState ?? null,
    patch.traceId !== undefined ? 1 : 0,
    patch.traceId ?? null,
    patch.plan !== undefined ? 1 : 0,
    patch.plan !== undefined ? stableJson(patch.plan) : null,
    patch.risk !== undefined ? 1 : 0,
    patch.risk !== undefined ? stableJson(patch.risk) : null,
    now,
    id
  );

  const task = await getAgentTask(db, id);
  if (task) {
    await appendAgentTaskEvent(db, {
      taskId: id,
      userId: task.userId,
      type: `task.${status}`,
      payload: {
        phase: patch.phase ?? task.phase,
        verified: patch.verification?.verified ?? task.verification?.verified ?? false,
      },
      traceId: patch.traceId ?? task.traceId,
      hybridState: patch.hybridState ?? task.hybridState,
    });
  }
}

export async function appendAgentTaskEvent(
  db: SQLiteDatabase,
  input: {
    taskId: string;
    userId: number;
    type: string;
    payload?: Record<string, unknown>;
    createdAt?: number;
    traceId?: string;
    hybridState?: HybridTaskState;
  }
): Promise<AgentTaskEvent> {
  await ensureHybridSchema(db);
  let saved: AgentTaskEvent | null = null;

  await db.withTransactionAsync(async () => {
    const [previous, sequenceRow] = await Promise.all([
      db.getFirstAsync(
        `SELECT previous_hash, hash FROM agent_task_events
         WHERE task_id = ? ORDER BY sequence DESC LIMIT 1`,
        input.taskId
      ) as Promise<{ previous_hash: string; hash: string } | null>,
      db.getFirstAsync(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_task_events`
      ) as Promise<{ sequence: number } | null>,
    ]);

    const createdAt = input.createdAt ?? Date.now();
    const previousHash = previous?.hash ?? '';
    const sequence = sequenceRow?.sequence ?? 1;
    const payload = input.payload ?? {};
    // Keep the v16 hash shape for legacy callers; hybrid fields only enter the
    // chain when they are actually supplied.
    const hashInput: Record<string, unknown> = {
      taskId: input.taskId,
      sequence,
      type: input.type,
      payload,
      createdAt,
      previousHash,
    };
    if (input.traceId != null) hashInput.traceId = input.traceId;
    if (input.hybridState != null) hashInput.hybridState = input.hybridState;
    const hash = hashChain(hashInput);

    await db.runAsync(
      `INSERT INTO agent_task_events (
        task_id, sequence, user_id, type, payload, created_at, previous_hash, hash,
        trace_id, hybrid_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.taskId,
      sequence,
      input.userId,
      input.type,
      stableJson(payload),
      createdAt,
      previousHash,
      hash,
      input.traceId ?? null,
      input.hybridState ?? null
    );

    const row = (await db.getFirstAsync(
      `SELECT ${EVENT_COLUMNS} FROM agent_task_events WHERE sequence = ?`,
      sequence
    )) as EventRow | null;

    if (!row) throw new Error('The task event could not be read back.');
    saved = rowToEvent(row);
  });

  if (!saved) throw new Error('The task event could not be saved.');
  return saved;
}

export async function listAgentTaskEvents(
  db: SQLiteDatabase,
  taskId: string,
  limit = 200
): Promise<AgentTaskEvent[]> {
  await ensureHybridSchema(db);
  const rows = (await db.getAllAsync(
    `SELECT ${EVENT_COLUMNS}
     FROM agent_task_events WHERE task_id = ? ORDER BY sequence ASC LIMIT ?`,
    taskId,
    Math.max(1, Math.min(1000, limit))
  )) as EventRow[];
  return rows.map(rowToEvent);
}

export async function recordAgentTaskAttempt(
  db: SQLiteDatabase,
  input: {
    taskId: string;
    attempt: number;
    toolName: string;
    status: AgentTaskAttempt['status'];
    startedAt: number;
    finishedAt?: number | null;
    durationMs?: number;
    errorCode?: string | null;
    error?: string | null;
    verification?: AgentTaskVerification | null;
    metadata?: Record<string, unknown>;
    traceId?: string;
    stepId?: string;
  }
): Promise<AgentTaskAttempt> {
  await ensureHybridSchema(db);
  const id = newAgentTaskId('attempt');
  await db.runAsync(
    `INSERT INTO agent_task_attempts (
      id, task_id, attempt, tool_name, status, started_at, finished_at, duration_ms,
      error_code, error, verification, metadata, trace_id, step_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.taskId,
    input.attempt,
    input.toolName,
    input.status,
    input.startedAt,
    input.finishedAt ?? null,
    input.durationMs ?? 0,
    input.errorCode ?? null,
    input.error ?? null,
    input.verification ? stableJson(input.verification) : null,
    stableJson(input.metadata ?? {}),
    input.traceId ?? null,
    input.stepId ?? null
  );

  const row = (await db.getFirstAsync(
    `SELECT ${ATTEMPT_COLUMNS} FROM agent_task_attempts WHERE id = ?`,
    id
  )) as AttemptRow | null;

  if (!row) throw new Error('The task attempt could not be read back.');
  return rowToAttempt(row);
}

export async function createAgentTaskSchedule(
  db: SQLiteDatabase,
  input: {
    id?: string;
    userId: number;
    ownerType: AgentTaskSchedule['ownerType'];
    ownerId: string;
    taskId?: string | null;
    title: string;
    input?: Record<string, unknown>;
    intervalMs?: number | null;
    nextRunAt: number;
    idempotencyKey: string;
    traceId?: string;
  }
): Promise<AgentTaskSchedule> {
  await ensureHybridSchema(db);
  const now = Date.now();
  const id = input.id ?? newAgentTaskId('schedule');

  await db.runAsync(
    `INSERT INTO agent_task_schedules (
      id, user_id, owner_type, owner_id, task_id, title, input_json, enabled,
      interval_ms, next_run_at, last_run_at, lease_owner, lease_until,
      idempotency_key, created_at, updated_at, trace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      input_json = excluded.input_json,
      interval_ms = excluded.interval_ms,
      next_run_at = excluded.next_run_at,
      enabled = 1,
      updated_at = excluded.updated_at,
      trace_id = COALESCE(excluded.trace_id, agent_task_schedules.trace_id)`,
    id,
    input.userId,
    input.ownerType,
    input.ownerId,
    input.taskId ?? null,
    input.title,
    stableJson(input.input ?? {}),
    input.intervalMs ?? null,
    input.nextRunAt,
    input.idempotencyKey,
    now,
    now,
    input.traceId ?? null
  );

  const schedule = await getAgentTaskSchedule(db, id);
  if (!schedule) throw new Error('The task schedule could not be read back.');
  return schedule;
}

export async function getAgentTaskSchedule(
  db: SQLiteDatabase,
  id: string
): Promise<AgentTaskSchedule | null> {
  await ensureHybridSchema(db);
  const row = (await db.getFirstAsync(
    `SELECT ${SCHEDULE_COLUMNS} FROM agent_task_schedules WHERE id = ?`,
    id
  )) as ScheduleRow | null;
  return row ? rowToSchedule(row) : null;
}

export async function claimDueAgentTaskSchedules(
  db: SQLiteDatabase,
  owner: string,
  now: number = Date.now(),
  leaseMs = 10 * 60_000,
  limit = 20
): Promise<AgentTaskSchedule[]> {
  await ensureHybridSchema(db);
  const rows = (await db.getAllAsync(
    `SELECT ${SCHEDULE_COLUMNS} FROM agent_task_schedules
     WHERE enabled = 1 AND next_run_at <= ?
       AND (lease_until IS NULL OR lease_until <= ?)
     ORDER BY next_run_at ASC LIMIT ?`,
    now,
    now,
    Math.max(1, Math.min(100, limit))
  )) as ScheduleRow[];

  const claimed: AgentTaskSchedule[] = [];
  for (const row of rows) {
    const result = await db.runAsync(
      `UPDATE agent_task_schedules
       SET lease_owner = ?, lease_until = ?, updated_at = ?
       WHERE id = ? AND (lease_until IS NULL OR lease_until <= ?)`,
      owner,
      now + leaseMs,
      now,
      row.id,
      now
    );
    if (result.changes > 0) {
      const schedule = await getAgentTaskSchedule(db, row.id);
      if (schedule) claimed.push(schedule);
    }
  }
  return claimed;
}

export async function completeAgentTaskSchedule(
  db: SQLiteDatabase,
  id: string,
  input: {
    completedAt?: number;
    nextRunAt?: number | null;
    disable?: boolean;
    attempt?: number;
    backoff?: Record<string, unknown>;
  }
): Promise<void> {
  await ensureHybridSchema(db);
  const now = input.completedAt ?? Date.now();
  await db.runAsync(
    `UPDATE agent_task_schedules SET
      last_run_at = ?,
      next_run_at = ?,
      enabled = ?,
      lease_owner = NULL,
      lease_until = NULL,
      attempt = CASE WHEN ? = 1 THEN ? ELSE attempt END,
      backoff_json = CASE WHEN ? = 1 THEN ? ELSE backoff_json END,
      updated_at = ?
     WHERE id = ?`,
    now,
    input.nextRunAt ?? now,
    input.disable ? 0 : 1,
    input.attempt !== undefined ? 1 : 0,
    input.attempt ?? null,
    input.backoff !== undefined ? 1 : 0,
    input.backoff !== undefined ? stableJson(input.backoff) : null,
    now,
    id
  );
}

export async function setAgentTaskScheduleEnabled(
  db: SQLiteDatabase,
  id: string,
  enabled: boolean
): Promise<void> {
  await db.runAsync(
    'UPDATE agent_task_schedules SET enabled = ?, lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ?',
    enabled ? 1 : 0,
    Date.now(),
    id
  );
}

export async function recoverInterruptedAgentTasks(
  db: SQLiteDatabase,
  options: { now?: number; staleMs?: number; owner?: string } = {}
): Promise<{ tasks: number; schedules: number }> {
  const now = options.now ?? Date.now();
  const staleBefore = now - (options.staleMs ?? 10 * 60 * 1000);

  const taskResult = await db.runAsync(
    `UPDATE agent_tasks
     SET status = 'needs_review',
         phase = 'verify',
         error = 'Interrupted before verification. Nothing was marked complete.',
         lease_owner = NULL,
         lease_until = NULL,
         finished_at = ?,
         updated_at = ?
     WHERE status IN ('running', 'awaiting_approval', 'awaiting_tool')
       AND (lease_until IS NULL OR lease_until <= ? OR updated_at <= ?)`,
    now,
    now,
    now,
    staleBefore
  );

  const scheduleResult = await db.runAsync(
    `UPDATE agent_task_schedules
     SET lease_owner = NULL, lease_until = NULL, updated_at = ?
     WHERE lease_until IS NOT NULL AND lease_until <= ?`,
    now,
    now
  );

  return { tasks: taskResult.changes, schedules: scheduleResult.changes };
}

function serializeApprovalBinding(binding: ApprovalBinding | string): string {
  return typeof binding === 'string' ? binding : stableJson(binding);
}

export async function createAgentTaskApproval(
  db: SQLiteDatabase,
  input: {
    id?: string;
    taskId: string;
    stepId: string;
    userId: number;
    permissionRequestId?: string | null;
    binding: ApprovalBinding | string;
    state?: ApprovalState;
    operationFingerprint: string;
    policyVersion?: string | null;
    createdAt?: number;
  }
): Promise<AgentTaskApproval> {
  await ensureHybridSchema(db);
  const id = input.id ?? newAgentTaskId('approval');
  const now = input.createdAt ?? Date.now();

  await db.runAsync(
    `INSERT INTO agent_task_approvals (
      id, task_id, step_id, user_id, permission_request_id, binding, state,
      operation_fingerprint, policy_version, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id,
    input.taskId,
    input.stepId,
    input.userId,
    input.permissionRequestId ?? null,
    serializeApprovalBinding(input.binding),
    input.state ?? 'pending',
    input.operationFingerprint,
    input.policyVersion ?? null,
    now,
    now
  );

  const approval = await getAgentTaskApproval(db, id);
  if (!approval) throw new Error('The task approval could not be read back.');
  return approval;
}

export async function updateAgentTaskApproval(
  db: SQLiteDatabase,
  id: string,
  patch: {
    state?: ApprovalState;
    resolvedAt?: number | null;
    permissionRequestId?: string | null;
    binding?: ApprovalBinding | string;
  }
): Promise<AgentTaskApproval | null> {
  await ensureHybridSchema(db);
  await db.runAsync(
    `UPDATE agent_task_approvals SET
      state = CASE WHEN ? = 1 THEN ? ELSE state END,
      resolved_at = CASE WHEN ? = 1 THEN ? ELSE resolved_at END,
      permission_request_id = CASE WHEN ? = 1 THEN ? ELSE permission_request_id END,
      binding = CASE WHEN ? = 1 THEN ? ELSE binding END,
      updated_at = ?
     WHERE id = ?`,
    patch.state !== undefined ? 1 : 0,
    patch.state ?? null,
    patch.resolvedAt !== undefined ? 1 : 0,
    patch.resolvedAt ?? null,
    patch.permissionRequestId !== undefined ? 1 : 0,
    patch.permissionRequestId ?? null,
    patch.binding !== undefined ? 1 : 0,
    patch.binding !== undefined ? serializeApprovalBinding(patch.binding) : null,
    Date.now(),
    id
  );
  return getAgentTaskApproval(db, id);
}

export async function getAgentTaskApproval(
  db: SQLiteDatabase,
  id: string
): Promise<AgentTaskApproval | null> {
  await ensureHybridSchema(db);
  const row = (await db.getFirstAsync(
    `SELECT ${APPROVAL_COLUMNS} FROM agent_task_approvals WHERE id = ?`,
    id
  )) as ApprovalRow | null;
  return row ? rowToApproval(row) : null;
}

export async function appendHybridAuditEvent(
  db: SQLiteDatabase,
  input: {
    traceId: string;
    taskId?: string | null;
    userId?: number | null;
    source: string;
    type: string;
    payload?: Record<string, unknown>;
    createdAt?: number;
  }
): Promise<HybridAuditEvent> {
  await ensureHybridSchema(db);
  let saved: HybridAuditEvent | null = null;

  await db.withTransactionAsync(async () => {
    const [previous, countRow] = await Promise.all([
      db.getFirstAsync<{ hash: string }>(
        `SELECT hash FROM hybrid_audit_events
         WHERE trace_id = ? ORDER BY id DESC LIMIT 1`,
        input.traceId
      ),
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM hybrid_audit_events WHERE trace_id = ?`,
        input.traceId
      ),
    ]);

    const previousHash = previous?.hash ?? '';
    const sequence = (countRow?.count ?? 0) + 1;
    const createdAt = input.createdAt ?? Date.now();
    const payload = input.payload ?? {};
    const taskId = input.taskId ?? null;
    const userId = input.userId ?? null;
    const hash = hashChain({
      traceId: input.traceId,
      sequence,
      taskId,
      userId,
      source: input.source,
      type: input.type,
      payload,
      createdAt,
      previousHash,
    });

    await db.runAsync(
      `INSERT INTO hybrid_audit_events (
        trace_id, task_id, user_id, source, type, payload, previous_hash, hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.traceId,
      taskId,
      userId,
      input.source,
      input.type,
      stableJson(payload),
      previousHash,
      hash,
      createdAt
    );

    const row = await db.getFirstAsync<HybridAuditRow>(
      `SELECT ${AUDIT_COLUMNS} FROM hybrid_audit_events
       WHERE trace_id = ? AND hash = ? ORDER BY id DESC LIMIT 1`,
      input.traceId,
      hash
    );
    if (!row) throw new Error('The hybrid audit event could not be read back.');
    saved = rowToHybridAuditEvent(row);
  });

  if (!saved) throw new Error('The hybrid audit event could not be saved.');
  return saved;
}

export async function listHybridAuditEvents(
  db: SQLiteDatabase,
  traceId: string,
  limit = 500
): Promise<HybridAuditEvent[]> {
  await ensureHybridSchema(db);
  const rows = await db.getAllAsync<HybridAuditRow>(
    `SELECT ${AUDIT_COLUMNS} FROM hybrid_audit_events
     WHERE trace_id = ? ORDER BY id ASC LIMIT ?`,
    traceId,
    Math.max(1, Math.min(2000, limit))
  );
  return rows.map(rowToHybridAuditEvent);
}

export async function verifyHybridAuditChain(
  db: SQLiteDatabase,
  traceId: string
): Promise<boolean> {
  await ensureHybridSchema(db);
  const rows = await db.getAllAsync<HybridAuditRow>(
    `SELECT ${AUDIT_COLUMNS} FROM hybrid_audit_events
     WHERE trace_id = ? ORDER BY id ASC`,
    traceId
  );
  if (rows.length === 0) return false;

  let expectedPreviousHash = '';
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.previous_hash !== expectedPreviousHash) return false;

    const expectedHash = hashChain({
      traceId: row.trace_id,
      sequence: index + 1,
      taskId: row.task_id,
      userId: row.user_id,
      source: row.source,
      type: row.type,
      payload: parseJson<Record<string, unknown>>(row.payload, {}),
      createdAt: row.created_at,
      previousHash: row.previous_hash,
    });
    if (expectedHash !== row.hash) return false;
    expectedPreviousHash = row.hash;
  }
  return true;
}
