import type { SQLiteDatabase } from 'expo-sqlite';

import { runAgent } from './ai/agent';
import { loadAiSettings } from './ai/settings';
import { getChatStore } from './chat';
import { MASTER_AGENT } from './permissions';

export type RunStatus = 'running' | 'success' | 'failed';

export type Workflow = {
  id: number;
  name: string;
  instruction: string;
  createdAt: number;
  updatedAt: number;
  runCount: number;
  lastRunAt: number | null;
  lastRunStatus: RunStatus | null;
};

export type WorkflowRun = {
  id: number;
  workflowId: number;
  workflowName: string;
  conversationId: number | null;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  summary: string;
  traces: string[];
};

export const WORKFLOW_NAME_MAX = 60;
export const WORKFLOW_INSTRUCTION_MAX = 1000;

/** A run that is still "running" after this long was interrupted (app closed). */
const STALE_RUN_MS = 10 * 60 * 1000;

type WorkflowRow = {
  id: number;
  name: string;
  instruction: string;
  created_at: number;
  updated_at: number;
  run_count: number;
  last_run_at: number | null;
  last_run_status: string | null;
};

type RunRow = {
  id: number;
  workflow_id: number;
  workflow_name: string;
  conversation_id: number | null;
  status: string;
  started_at: number;
  finished_at: number | null;
  summary: string;
  traces: string;
};

function toRunStatus(value: string | null): RunStatus | null {
  return value === 'running' || value === 'success' || value === 'failed' ? value : null;
}

function parseTraces(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;

    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    lastRunStatus: toRunStatus(row.last_run_status),
  };
}

function mapRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    conversationId: row.conversation_id,
    status: toRunStatus(row.status) ?? 'failed',
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: row.summary,
    traces: parseTraces(row.traces),
  };
}

/** Returns an error message, or null when the draft is valid. */
export function validateWorkflowDraft(name: string, instruction: string): string | null {
  const cleanName = name.trim();
  const cleanInstruction = instruction.trim();

  if (!cleanName) {
    return 'Give the workflow a name.';
  }

  if (cleanName.length > WORKFLOW_NAME_MAX) {
    return `The name can be at most ${WORKFLOW_NAME_MAX} characters.`;
  }

  if (!cleanInstruction) {
    return 'Describe what the workflow should do.';
  }

  if (cleanInstruction.length > WORKFLOW_INSTRUCTION_MAX) {
    return `The instruction can be at most ${WORKFLOW_INSTRUCTION_MAX} characters.`;
  }

  return null;
}

const WORKFLOW_SELECT = `
  SELECT w.id, w.name, w.instruction, w.created_at, w.updated_at,
    (SELECT COUNT(*) FROM workflow_runs r WHERE r.workflow_id = w.id) AS run_count,
    (SELECT r.started_at FROM workflow_runs r WHERE r.workflow_id = w.id ORDER BY r.id DESC LIMIT 1) AS last_run_at,
    (SELECT r.status FROM workflow_runs r WHERE r.workflow_id = w.id ORDER BY r.id DESC LIMIT 1) AS last_run_status
  FROM workflows w
`;

const RUN_SELECT = `
  SELECT r.id, r.workflow_id, w.name AS workflow_name, r.conversation_id, r.status,
    r.started_at, r.finished_at, r.summary, r.traces
  FROM workflow_runs r
  JOIN workflows w ON w.id = r.workflow_id
`;

export class WorkflowStore {
  constructor(private db: SQLiteDatabase) {}

  async list(userId: number): Promise<Workflow[]> {
    const rows = await this.db.getAllAsync<WorkflowRow>(
      `${WORKFLOW_SELECT} WHERE w.user_id = ? ORDER BY w.updated_at DESC`,
      userId
    );

    return rows.map(mapWorkflow);
  }

  async create(userId: number, name: string, instruction: string): Promise<number> {
    const now = Date.now();
    const result = await this.db.runAsync(
      'INSERT INTO workflows (user_id, name, instruction, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      userId,
      name.trim(),
      instruction.trim(),
      now,
      now
    );

    return result.lastInsertRowId;
  }

  async update(userId: number, id: number, name: string, instruction: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE workflows SET name = ?, instruction = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      name.trim(),
      instruction.trim(),
      Date.now(),
      id,
      userId
    );
  }

  async remove(userId: number, id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM workflows WHERE id = ? AND user_id = ?', id, userId);
  }

  async listRuns(userId: number, limit = 30): Promise<WorkflowRun[]> {
    const rows = await this.db.getAllAsync<RunRow>(
      `${RUN_SELECT} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT ?`,
      userId,
      limit
    );

    return rows.map(mapRun);
  }

  async getRun(userId: number, id: number): Promise<WorkflowRun | null> {
    const row = await this.db.getFirstAsync<RunRow>(
      `${RUN_SELECT} WHERE r.user_id = ? AND r.id = ?`,
      userId,
      id
    );

    return row ? mapRun(row) : null;
  }

  async startRun(userId: number, workflowId: number, conversationId: number): Promise<number> {
    const result = await this.db.runAsync(
      "INSERT INTO workflow_runs (user_id, workflow_id, conversation_id, status, started_at) VALUES (?, ?, ?, 'running', ?)",
      userId,
      workflowId,
      conversationId,
      Date.now()
    );

    return result.lastInsertRowId;
  }

  async finishRun(
    id: number,
    status: Exclude<RunStatus, 'running'>,
    summary: string,
    traces: string[]
  ): Promise<void> {
    await this.db.runAsync(
      'UPDATE workflow_runs SET status = ?, finished_at = ?, summary = ?, traces = ? WHERE id = ?',
      status,
      Date.now(),
      summary.slice(0, 4000),
      JSON.stringify(traces),
      id
    );
  }

  /** Marks runs left "running" by a closed app as failed so they don't spin forever. */
  async recoverStaleRuns(userId: number): Promise<void> {
    const now = Date.now();

    await this.db.runAsync(
      "UPDATE workflow_runs SET status = 'failed', finished_at = ?, summary = 'Interrupted — the app was closed before this run finished.' WHERE user_id = ? AND status = 'running' AND started_at < ?",
      now,
      userId,
      now - STALE_RUN_MS
    );
  }
}

const runningWorkflows = new Set<number>();

export function isWorkflowRunning(workflowId: number): boolean {
  return runningWorkflows.has(workflowId);
}

/**
 * Runs a workflow once through the same agent loop as chat, in its own
 * conversation so the transcript can be opened later. Tool calls still go
 * through the permission gate, so sensitive actions pause for approval.
 */
export async function runWorkflow(
  db: SQLiteDatabase,
  user: { id: number; name: string },
  workflow: Pick<Workflow, 'id' | 'name' | 'instruction'>
): Promise<WorkflowRun> {
  if (runningWorkflows.has(workflow.id)) {
    throw new Error('This workflow is already running.');
  }

  runningWorkflows.add(workflow.id);

  const store = new WorkflowStore(db);
  const chat = getChatStore(db);
  let runId: number | null = null;

  try {
    const settings = await loadAiSettings();
    const conversation = await chat.createConversation(user.id, `Workflow: ${workflow.name}`);

    await chat.addMessage(user.id, conversation.id, 'user', workflow.instruction);
    runId = await store.startRun(user.id, workflow.id, conversation.id);

    const result = await runAgent({
      db,
      userId: user.id,
      userName: user.name,
      history: [{ role: 'user', content: workflow.instruction }],
      settings,
      conversationId: conversation.id,
      agent: MASTER_AGENT,
      projectId: `workflow-${workflow.id}`,
      projectLabel: `Workflow: ${workflow.name}`,
    });

    await chat.addMessage(user.id, conversation.id, 'assistant', result.reply, result.traces);
    await store.finishRun(runId, 'success', result.reply, result.traces);
  } catch (runError) {
    if (runId === null) {
      throw runError;
    }

    const message = runError instanceof Error ? runError.message : 'The workflow failed.';

    await store.finishRun(runId, 'failed', message, []);
  } finally {
    runningWorkflows.delete(workflow.id);
  }

  if (runId === null) {
    throw new Error('The workflow could not be started.');
  }

  const finished = await store.getRun(user.id, runId);

  if (!finished) {
    throw new Error('The run finished but could not be loaded.');
  }

  return finished;
}
