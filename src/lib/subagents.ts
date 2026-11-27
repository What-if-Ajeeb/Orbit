import type { SQLiteDatabase } from 'expo-sqlite';

import type { AgentBudget } from './agent-runtime/types';
import { revokeSubagentGrants } from './subagents/grants';
import { runSubagentTask } from './subagents/runtime';

export type SubagentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export type SubagentTask = {
  id: string;
  name: string;
  description: string;
  status: SubagentStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string | null;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  parentConversationId?: number;
  agentId?: string;
};

export type SubagentPlugin = {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[]; // Tool names this subagent can use
  enabled: boolean;
};

type TaskRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  parent_conversation_id: number | null;
  agent_id: string | null;
};

export class SubagentStore {
  constructor(private db: SQLiteDatabase) {}

  async listSubagents(): Promise<SubagentPlugin[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT id, name, description, version, capabilities, enabled FROM subagents ORDER BY name ASC`
    )) as { id: string; name: string; description: string; version: string; capabilities: string | null; enabled: number }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
      enabled: row.enabled === 1,
    }));
  }

  async getSubagent(id: string): Promise<SubagentPlugin | null> {
    const subagents = await this.listSubagents();
    return subagents.find((s) => s.id === id) ?? null;
  }

  async registerSubagent(plugin: Omit<SubagentPlugin, 'id'>): Promise<SubagentPlugin> {
    const id = `subagent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    await this.db.runAsync(
      `INSERT INTO subagents (id, name, description, version, capabilities, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      plugin.name,
      plugin.description,
      plugin.version,
      JSON.stringify(plugin.capabilities),
      now,
      now
    );

    return { ...plugin, id };
  }

  async updateSubagent(id: string, patch: Partial<Omit<SubagentPlugin, 'id'>>): Promise<void> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
    if (patch.version !== undefined) { fields.push('version = ?'); values.push(patch.version); }
    if (patch.capabilities !== undefined) { fields.push('capabilities = ?'); values.push(JSON.stringify(patch.capabilities)); }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0); }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    await this.db.runAsync(`UPDATE subagents SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }

  async deleteSubagent(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM subagents WHERE id = ?', id);
  }

  async setSubagentEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.runAsync('UPDATE subagents SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, Date.now(), id);
  }

  async createTask(task: {
    name: string;
    description: string;
    input: Record<string, unknown>;
    parentConversationId?: number;
    agentId?: string;
  }): Promise<SubagentTask> {
    const id = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    await this.db.runAsync(
      `INSERT INTO subagent_tasks (id, name, description, status, input, created_at, parent_conversation_id, agent_id)
       VALUES (?, ?, ?, 'idle', ?, ?, ?, ?)`,
      id,
      task.name,
      task.description,
      JSON.stringify(task.input),
      now,
      task.parentConversationId ?? null,
      task.agentId ?? null
    );

    return {
      id,
      name: task.name,
      description: task.description,
      status: 'idle',
      input: task.input,
      createdAt: now,
      parentConversationId: task.parentConversationId,
      agentId: task.agentId,
    };
  }

  async getTask(id: string): Promise<SubagentTask | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT id, name, description, status, input, output, error, created_at, started_at, completed_at, parent_conversation_id, agent_id
       FROM subagent_tasks WHERE id = ?`,
      id
    )) as TaskRow | null;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status as SubagentStatus,
      input: JSON.parse(row.input),
      output: row.output ? JSON.parse(row.output) : undefined,
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      parentConversationId: row.parent_conversation_id ?? undefined,
      agentId: row.agent_id ?? undefined,
    };
  }

  async listTasks(conversationId?: number): Promise<SubagentTask[]> {
    const rows = (conversationId
      ? (await this.db.getAllAsync(
          `SELECT id, name, description, status, input, output, error, created_at, started_at, completed_at, parent_conversation_id, agent_id
           FROM subagent_tasks WHERE parent_conversation_id = ? ORDER BY created_at DESC`,
          conversationId
        ))
      : (await this.db.getAllAsync(
          `SELECT id, name, description, status, input, output, error, created_at, started_at, completed_at, parent_conversation_id, agent_id
           FROM subagent_tasks ORDER BY created_at DESC`
        ))) as { id: string; name: string; description: string; status: string; input: string; output: string | null; error: string | null; created_at: number; started_at: number | null; completed_at: number | null; parent_conversation_id: number | null; agent_id: string | null }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status as SubagentStatus,
      input: JSON.parse(row.input),
      output: row.output ? JSON.parse(row.output) : undefined,
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      parentConversationId: row.parent_conversation_id ?? undefined,
      agentId: row.agent_id ?? undefined,
    }));
  }

  async updateTaskStatus(id: string, status: SubagentStatus, output?: Record<string, unknown>, error?: string): Promise<void> {
    const completedValue =
      status === 'completed' || status === 'failed' || status === 'cancelled'
        ? Date.now()
        : null;
    const outputValue = output !== undefined ? JSON.stringify(output) : null;

    await this.db.runAsync(
      `UPDATE subagent_tasks SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ?`,
      status,
      outputValue,
      error ?? null,
      completedValue,
      id
    );
  }

  async markTaskStarted(id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE subagent_tasks SET status = 'running', started_at = ? WHERE id = ?`,
      Date.now(),
      id
    );
  }
}

export class SubagentExecutor {
  private store: SubagentStore;

  constructor(private db: SQLiteDatabase) {
    this.store = new SubagentStore(db);
  }

  async delegateTask(
    subagentId: string,
    taskName: string,
    taskDescription: string,
    input: Record<string, unknown>,
    conversationId?: number,
    agentId?: string,
    options: {
      userId?: number;
      userName?: string;
      requestedTools?: string[];
      parentTaskId?: string;
      projectId?: string;
      projectLabel?: string;
      budget?: AgentBudget;
      depth?: number;
      maxDepth?: number;
      signal?: AbortSignal;
    } = {}
  ): Promise<SubagentTask> {
    const subagent = await this.store.getSubagent(subagentId);
    if (!subagent) throw new Error(`Subagent ${subagentId} not found`);
    if (!subagent.enabled) throw new Error(`Subagent ${subagentId} is disabled`);

    const requestedTools = options.requestedTools ?? subagent.capabilities;
    if (requestedTools.length === 0) {
      throw new Error(`Subagent ${subagentId} has no explicit capability grants.`);
    }

    const instruction = [taskName, taskDescription, JSON.stringify(input)]
      .filter(Boolean)
      .join('\n');
    const result = await runSubagentTask(this.db, {
      userId: options.userId ?? Number((input.userId as number | undefined) ?? 0),
      userName: options.userName ?? (input.userName as string | undefined) ?? 'User',
      subagentId,
      instruction,
      requestedTools,
      parentTaskId: options.parentTaskId,
      conversationId,
      projectId: options.projectId,
      projectLabel: options.projectLabel,
      budget: options.budget,
      depth: options.depth,
      maxDepth: options.maxDepth,
      signal: options.signal,
    });

    const legacy = await this.store.getTask(result.subagentTaskId);
    if (!legacy) throw new Error('The delegated task could not be loaded.');

    return {
      ...legacy,
      output: {
        reply: result.reply,
        traces: result.traces,
        verification: result.verification,
        agentTaskId: result.agentTaskId,
      },
    };
  }

  async cancelTask(id: string): Promise<void> {
    const row = await this.db.getFirstAsync(
      'SELECT input FROM subagent_tasks WHERE id = ?',
      id
    ) as { input: string } | null;

    if (row) {
      try {
        const parsed = JSON.parse(row.input) as { agentTaskId?: string; requestedTools?: string[] };
        if (parsed.agentTaskId) {
          const agentTask = await this.db.getFirstAsync(
            'SELECT subagent_id, user_id FROM agent_tasks WHERE id = ?',
            parsed.agentTaskId
          ) as { subagent_id: string | null; user_id: number } | null;
          if (agentTask?.subagent_id) {
            await revokeSubagentGrants(
              this.db,
              agentTask.user_id,
              parsed.agentTaskId,
              agentTask.subagent_id
            );
          }
        }
      } catch {
        // A malformed legacy row must not prevent cancellation.
      }
    }

    await this.store.updateTaskStatus(id, 'cancelled');
  }
}
