import type { SQLiteDatabase } from 'expo-sqlite';

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

  constructor(db: SQLiteDatabase) {
    this.store = new SubagentStore(db);
  }


  async delegateTask(
    subagentId: string,
    taskName: string,
    taskDescription: string,
    input: Record<string, unknown>,
    conversationId?: number,
    agentId?: string
  ): Promise<SubagentTask> {
    const subagent = await this.store.getSubagent(subagentId);
    if (!subagent) {
      throw new Error(`Subagent ${subagentId} not found`);
    }

    if (!subagent.enabled) {
      throw new Error(`Subagent ${subagentId} is disabled`);
    }

    const task = await this.store.createTask({
      name: taskName,
      description: taskDescription,
      input,
      parentConversationId: conversationId,
      agentId: agentId,
    });

    await this.store.markTaskStarted(task.id);

    // Simulate subagent execution
    void (async () => {
      try {
        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const output = {
          result: `Completed task "${taskName}" using subagent ${subagent.name}`,
          input,
          agent: subagent.name,
          timestamp: Date.now(),
        };

        await this.store.updateTaskStatus(task.id, 'completed', output);
      } catch (error) {
        await this.store.updateTaskStatus(
          task.id,
          'failed',
          undefined,
          error instanceof Error ? error.message : 'Task execution failed'
        );
      }
    })();

    return { ...task, status: 'running', startedAt: Date.now() };
  }

  async cancelTask(id: string): Promise<void> {
    await this.store.updateTaskStatus(id, 'cancelled');
  }
}
