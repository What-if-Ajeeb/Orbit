import type { SQLiteDatabase } from 'expo-sqlite';

import { hashChain, stableJson } from './agent-runtime/hash';
import type { CapabilityGrant } from './agent-runtime/types';
import { toolFail, agentToolRegistry, type AgentTool } from './ai/tool-registry';
import type { JsonSchema } from './ai/types';
import { MASTER_AGENT } from './permissions/agents';
import type { AgentIdentity } from './permissions/types';

import type {
  DeclarativeSkillContext,
  DeclarativeSkillExecution,
} from './skills/executor';
import {
  builtinSkillManifests,
  declarativeToolDefinitions,
  parseSkillManifest,
  WEB_SEARCH_SKILL_ID,
  type SkillManifest,
  type SkillStep,
} from './skills/manifest';

export {
  WEB_SEARCH_CAPABILITY,
  WEB_SEARCH_SKILL_ID,
  WEB_SEARCH_TOOL_NAME,
} from './skills/manifest';

export type SkillStatus = 'active' | 'inactive' | 'error' | 'loading';

export type SkillCapability = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: Record<string, unknown>;
  steps?: SkillStep[];
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

export type SkillExecution = DeclarativeSkillExecution;

function toLegacySkill(manifest: SkillManifest): SkillPlugin {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    capabilities: manifest.capabilities.map((capability) => ({
      name: capability.name,
      description: capability.description,
      inputSchema: capability.inputSchema,
      steps: capability.steps,
    })),
    enabled: manifest.enabled,
    autoLoad: manifest.autoLoad,
  };
}

function parseStoredCapabilities(raw: string | null): SkillCapability[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SkillCapability[]) : [];
  } catch {
    return [];
  }
}

/** Stores an immutable, integrity-checked declarative manifest version. */
export async function saveSkillManifestVersion(
  db: SQLiteDatabase,
  manifest: SkillManifest,
  source = 'builtin'
): Promise<void> {
  const parsed = JSON.parse(stableJson(manifest)) as unknown;
  const validated = parseSkillManifest(parsed);

  await db.runAsync(
    `INSERT INTO skill_versions (skill_id, version, manifest, manifest_hash, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(skill_id, version) DO NOTHING`,
    validated.id,
    validated.version,
    stableJson(validated),
    hashChain(parsed),
    source,
    Date.now()
  );
}

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
        capabilities: parseStoredCapabilities(row.capabilities),
        enabled: row.enabled === 1,
        autoLoad: row.auto_load === 1,
      }));
    } catch {
      return defaultSkills().map((skill) => ({ ...skill }));
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
  return builtinSkillManifests().map(toLegacySkill);
}

/** Seeds built-in skill rows and their immutable declarative manifests. */
export async function ensureBuiltinSkills(db: SQLiteDatabase): Promise<void> {
  const store = new SkillStore(db);
  for (const manifest of builtinSkillManifests()) {
    await store.ensureSkill(toLegacySkill(manifest));
    await saveSkillManifestVersion(db, manifest);
  }
}

export async function getActiveSkillManifests(
  db: SQLiteDatabase,
  options: { webSearchDisabled?: boolean } = {}
): Promise<SkillManifest[]> {
  const store = new SkillStore(db);
  const skills = await store.listSkills();
  const manifests: SkillManifest[] = [];

  for (const skill of skills) {
    if (!skill.enabled) continue;
    if (options.webSearchDisabled && skill.id === WEB_SEARCH_SKILL_ID) continue;

    let manifest: SkillManifest | null = null;
    try {
      const stored = await db.getFirstAsync(
        `SELECT manifest FROM skill_versions WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        skill.id
      ) as { manifest: string } | null;
      if (stored) manifest = parseSkillManifest(JSON.parse(stored.manifest));
    } catch {
      manifest = null;
    }

    if (!manifest || manifest.version !== skill.version || !manifest.enabled) continue;
    manifests.push(manifest);
  }

  return manifests;
}

/**
 * Skill tools are ordinary registry definitions. Their implementations are
 * intentionally inert: the orchestrator expands declarative steps and sends
 * each mapped tool through the permission + sandbox pipeline exactly once.
 */
export async function registerDeclarativeSkillTools(
  db: SQLiteDatabase,
  options: { webSearchDisabled?: boolean } = {}
): Promise<SkillManifest[]> {
  const manifests = await getActiveSkillManifests(db, options);

  for (const manifest of manifests) {
    for (const definition of declarativeToolDefinitions(manifest)) {
      const tool: AgentTool = {
        meta: { source: 'builtin' },
        definition,
        execute: async () => ({
          content: toolFail(
            `${definition.name} must be dispatched through the ORBIT agent runtime.`
          ),
          trace: '',
        }),
      };
      agentToolRegistry.register(tool, { replace: true });
    }
  }

  return manifests;
}

export class SkillExecutor {
  constructor(private store: SkillStore) {}

  async execute(
    skillId: string,
    capability: string,
    input: Record<string, unknown>,
    context?: Partial<DeclarativeSkillContext>
  ): Promise<SkillExecution> {
    const skill = await this.store.getSkill(skillId);
    const agent: AgentIdentity = context?.agent ?? MASTER_AGENT;
    const db = (context?.db ?? (this.store as unknown as { db: SQLiteDatabase }).db);
    // Loaded only when a skill actually executes: the executor installs the
    // native sandbox bridge, which must not be imported by preference stores.
    const { executeDeclarativeSkill } = await import('./skills/executor');

    return executeDeclarativeSkill(
      {
        db,
        userId: context?.userId ?? 0,
        conversationId: context?.conversationId,
        agent,
        projectId: context?.projectId ?? 'orbit-workspace',
        projectLabel: context?.projectLabel ?? 'Orbit workspace',
        signal: context?.signal,
        grants: context?.grants as CapabilityGrant[] | undefined,
        isToolAllowed: context?.isToolAllowed,
        sandboxGate: context?.sandboxGate,
      },
      skillId,
      capability,
      input
    ).then((execution) => ({
      ...execution,
      output: skill ? execution.output : { error: `Skill ${skillId} not found.` },
      success: skill ? execution.success : false,
      error: skill ? execution.error : `Skill ${skillId} not found.`,
    }));
  }
}
