import type { SQLiteDatabase } from 'expo-sqlite';

import type { JsonSchema } from './ai/types';

export const WEB_SEARCH_SKILL_ID = 'skill_web_search';
export const WEB_SEARCH_CAPABILITY = 'search_web';
export const WEB_SEARCH_TOOL_NAME = `${WEB_SEARCH_SKILL_ID}_${WEB_SEARCH_CAPABILITY}`;

export type SkillStatus = 'active' | 'inactive' | 'error' | 'loading';

export type SkillCapability = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: Record<string, unknown>;
};

export type SkillPlugin = {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: SkillCapability[];
  enabled: boolean;
  autoLoad: boolean;
};

export type SkillExecution = {
  skillId: string;
  capability: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
};

export class SkillStore {
  constructor(private db: SQLiteDatabase) {}

  async listSkills(): Promise<SkillPlugin[]> {
    try {
      const rows = (await this.db.getAllAsync(
        `SELECT id, name, description, version, capabilities, enabled, auto_load FROM skills ORDER BY name ASC`
      )) as { id: string; name: string; description: string; version: string; capabilities: string | null; enabled: number; auto_load: number }[];

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version,
        capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
        enabled: row.enabled === 1,
        autoLoad: row.auto_load === 1,
      }));
    } catch {
      return defaultSkills().map((s) => ({ ...s }));
    }
  }

  async getSkill(id: string): Promise<SkillPlugin | null> {
    const skills = await this.listSkills();
    return skills.find((s) => s.id === id) ?? null;
  }

  async registerSkill(plugin: Omit<SkillPlugin, 'id'>): Promise<SkillPlugin> {
    const id = `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    await this.db.runAsync(
      `INSERT INTO skills (id, name, description, version, capabilities, enabled, auto_load, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      id,
      plugin.name,
      plugin.description,
      plugin.version,
      JSON.stringify(plugin.capabilities),
      now,
      now
    );

    const created = await this.getSkill(id);
    if (!created) {
      throw new Error(`Failed to load skill ${id} after insert`);
    }
    return created;
  }

  async updateSkill(id: string, patch: Partial<Omit<SkillPlugin, 'id'>>): Promise<void> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
    if (patch.version !== undefined) { fields.push('version = ?'); values.push(patch.version); }
    if (patch.capabilities !== undefined) { fields.push('capabilities = ?'); values.push(JSON.stringify(patch.capabilities)); }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0); }
    if (patch.autoLoad !== undefined) { fields.push('auto_load = ?'); values.push(patch.autoLoad ? 1 : 0); }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    await this.db.runAsync(`UPDATE skills SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }

  async deleteSkill(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM skills WHERE id = ?', id);
  }

  async setSkillEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.runAsync('UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, Date.now(), id);
  }

  /** Inserts a built-in skill once; never overwrites a user-edited definition. */
  async ensureSkill(skill: SkillPlugin): Promise<void> {
    const now = Date.now();

    await this.db.runAsync(
      `INSERT INTO skills (id, name, description, version, capabilities, enabled, auto_load, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      skill.id,
      skill.name,
      skill.description,
      skill.version,
      JSON.stringify(skill.capabilities),
      skill.enabled ? 1 : 0,
      skill.autoLoad ? 1 : 0,
      now,
      now
    );
  }
}

export function getDefaultSkill(id: string): SkillPlugin | null {
  const found = defaultSkills().find((skill) => skill.id === id);
  return found ? { ...found, capabilities: found.capabilities.map((cap) => ({ ...cap })) } : null;
}

function defaultSkills(): SkillPlugin[] {
  return [
    {
      id: 'skill_file_reader',
      name: 'File Reader',
      description: 'Read files from local storage or external sources',
      version: '1.0.0',
      capabilities: [
        {
          name: 'read_file',
          description: 'Read contents of a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      ],
      enabled: true,
      autoLoad: false,
    },
    {
      id: 'skill_web_search',
      name: 'Web Search',
      description: 'Search the web for information',
      version: '1.0.0',
      capabilities: [
        {
          name: 'search_web',
          description: 'Search the internet for information',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      ],
      enabled: true,
      autoLoad: false,
    },
    {
      id: 'skill_database_query',
      name: 'Database Query',
      description: 'Execute SQL queries against connected databases',
      version: '1.0.0',
      capabilities: [
        {
          name: 'query_db',
          description: 'Run a SQL query',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      ],
      enabled: false,
      autoLoad: false,
    },
  ];
}

export class SkillExecutor {
  constructor(private store: SkillStore) {}

  async execute(
    skillId: string,
    capability: string,
    input: Record<string, unknown>
  ): Promise<SkillExecution> {
    const start = Date.now();
    const skill = await this.store.getSkill(skillId);

    if (!skill) {
      return {
        skillId,
        capability,
        input,
        output: {},
        durationMs: Date.now() - start,
        success: false,
        error: `Skill ${skillId} not found`,
        timestamp: start,
      };
    }

    if (!skill.enabled) {
      return {
        skillId,
        capability,
        input,
        output: {},
        durationMs: Date.now() - start,
        success: false,
        error: `Skill ${skillId} is disabled`,
        timestamp: start,
      };
    }

    try {
      // Simulate skill execution - in production this would load the skill module
      const result = await this.executeCapability(skill, capability, input);
      return {
        skillId,
        capability,
        input,
        output: result,
        durationMs: Date.now() - start,
        success: true,
        timestamp: start,
      };
    } catch (error) {
      return {
        skillId,
        capability,
        input,
        output: {},
        durationMs: Date.now() - start,
        success: false,
        error: error instanceof Error ? error.message : 'Skill execution failed',
        timestamp: start,
      };
    }
  }

  private async executeCapability(
    skill: SkillPlugin,
    capability: string,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Simulated skill execution - real implementation loads skill modules
    const cap = skill.capabilities.find((c) => c.name === capability);
    if (!cap) {
      throw new Error(`Capability ${capability} not found in skill ${skill.id}`);
    }

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      result: `Executed ${capability} on skill ${skill.name}`,
      input,
      timestamp: Date.now(),
    };
  }
}
