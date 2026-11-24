import type { SQLiteDatabase } from 'expo-sqlite';

export type HookType =
  | 'before_tool_call'
  | 'after_tool_call'
  | 'before_agent_turn'
  | 'after_agent_turn'
  | 'before_mcp_call'
  | 'after_mcp_call'
  | 'before_skill_execution'
  | 'after_skill_execution'
  | 'on_error'
  | 'on_success';

export type HookContext = {
  timestamp: number;
  userId: number;
  conversationId?: number;
  [key: string]: unknown;
};

export type HookPlugin = {
  id: string;
  name: string;
  description: string;
  hookType: HookType;
  enabled: boolean;
  /** Legacy JavaScript payload. Kept for data compatibility; never executed. */
  code: string;
  priority: number; // Lower runs first
};

export type HookExecution = {
  hookId: string;
  hookType: HookType;
  context: HookContext;
  result: Record<string, unknown>;
  success: boolean;
  error?: string;
  durationMs: number;
  timestamp: number;
};

type HookRow = {
  id: string;
  name: string;
  description: string;
  hook_type: string;
  enabled: number;
  code: string;
  priority: number;
};

export class HookStore {
  constructor(private db: SQLiteDatabase) {}

  async listHooks(): Promise<HookPlugin[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT id, name, description, hook_type, enabled, code, priority FROM hooks ORDER BY priority ASC, name ASC`
    )) as HookRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      hookType: row.hook_type as HookType,
      enabled: row.enabled === 1,
      code: row.code,
      priority: row.priority,
    }));
  }

  async getHook(id: string): Promise<HookPlugin | null> {
    const hooks = await this.listHooks();
    return hooks.find((h) => h.id === id) ?? null;
  }

  async createHook(hook: Omit<HookPlugin, 'id'>): Promise<HookPlugin> {
    const id = `hook_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    await this.db.runAsync(
      `INSERT INTO hooks (id, name, description, hook_type, enabled, code, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      id,
      hook.name,
      hook.description,
      hook.hookType,
      hook.code,
      hook.priority,
      now,
      now
    );

    return { ...hook, id };
  }

  async updateHook(id: string, patch: Partial<Omit<HookPlugin, 'id'>>): Promise<void> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
    if (patch.hookType !== undefined) { fields.push('hook_type = ?'); values.push(patch.hookType); }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0); }
    if (patch.code !== undefined) { fields.push('code = ?'); values.push(patch.code); }
    if (patch.priority !== undefined) { fields.push('priority = ?'); values.push(patch.priority); }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    await this.db.runAsync(`UPDATE hooks SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }

  async deleteHook(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM hooks WHERE id = ?', id);
  }

  async setHookEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.runAsync('UPDATE hooks SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, Date.now(), id);
  }
}

export class HookEngine {
  private store: HookStore;
  private hooks: HookPlugin[] | null = null;

  constructor(db: SQLiteDatabase) {
    this.store = new HookStore(db);
  }

  async loadHooks(): Promise<HookPlugin[]> {
    if (this.hooks) return this.hooks;
    this.hooks = await this.store.listHooks();
    return this.hooks;
  }

  async getHooksForType(hookType: HookType): Promise<HookPlugin[]> {
    const hooks = await this.loadHooks();
    return hooks
      .filter((h) => h.hookType === hookType && h.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  async executeHook(
    hookType: HookType,
    context: HookContext
  ): Promise<HookExecution[]> {
    const hooks = await this.getHooksForType(hookType);
    const executions: HookExecution[] = [];

    for (const hook of hooks) {
      const start = Date.now();
      try {
        // Legacy hooks are audited but never executed. ORBIT plugins use the
        // declarative manifest and reviewed built-in implementations instead.
        const result = await this.runHookCode(hook, context);
        executions.push({
          hookId: hook.id,
          hookType,
          context,
          result,
          success: true,
          durationMs: Date.now() - start,
          timestamp: start,
        });
      } catch (error) {
        executions.push({
          hookId: hook.id,
          hookType,
          context,
          result: {},
          success: false,
          error: error instanceof Error ? error.message : 'Hook execution failed',
          durationMs: Date.now() - start,
          timestamp: start,
        });
      }
    }

    return executions;
  }

  private async runHookCode(
    _hook: HookPlugin,
    _context: HookContext
  ): Promise<Record<string, unknown>> {
    // `new Function` was removed: stored hook strings are untrusted data and
    // are never compiled or evaluated. Returning a failed execution keeps the
    // audit trail visible while preserving existing callers of executeHook().
    throw new Error(
      'Legacy hook code execution is disabled. Use a declarative plugin instead.'
    );
  }
}
