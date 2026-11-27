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

/** Legacy UI/runtime status. Kept unchanged for existing callers. */
export type SkillStatus = 'active' | 'inactive' | 'error' | 'loading';

/** Strict lifecycle for immutable declarative skill versions. */
export const SKILL_LIFECYCLE_STATES = [
  'draft',
  'validated',
  'approved',
  'active',
  'deprecated',
  'rolled_back',
] as const;

export type SkillLifecycleState = (typeof SKILL_LIFECYCLE_STATES)[number];

export type SkillVersionTransition = {
  skillId: string;
  version: string;
  previousVersion: string | null;
  state: SkillLifecycleState;
};

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
      ...(capability.outputSchema ? { outputSchema: capability.outputSchema } : {}),
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

type SkillVersionRow = {
  version: string;
  manifest: string;
  manifest_hash: string;
  created_at: number;
};

/**
 * In-process lifecycle marker for transitions the schema cannot persist yet.
 * Keyed by database instance so separate stores never share state.
 */
const lifecycleOverlays = new WeakMap<object, Map<string, { version: string; state: SkillLifecycleState }>>();

function setLifecycleOverlay(
  db: SQLiteDatabase,
  skillId: string,
  version: string,
  state: SkillLifecycleState
): void {
  let skills = lifecycleOverlays.get(db as object);
  if (!skills) {
    skills = new Map();
    lifecycleOverlays.set(db as object, skills);
  }
  skills.set(skillId, { version, state });
}

/** Parses and integrity-checks a stored immutable manifest before any activation. */
function parseVerifiedVersion(skillId: string, row: SkillVersionRow): SkillManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.manifest);
  } catch {
    throw new Error(`Skill ${skillId} version ${row.version} has a corrupt stored manifest.`);
  }

  const manifest = parseSkillManifest(parsed);
  if (manifest.id !== skillId || manifest.version !== row.version) {
    throw new Error(`Skill ${skillId} version ${row.version} does not match its stored manifest.`);
  }
  if (hashChain(parsed) !== row.manifest_hash) {
    throw new Error(`Skill ${skillId} version ${row.version} failed its integrity check.`);
  }
  return manifest;
}

async function readSkillVersion(
  db: SQLiteDatabase,
  skillId: string,
  version: string
): Promise<SkillVersionRow | null> {
  return (await db.getFirstAsync(
    `SELECT version, manifest, manifest_hash, created_at FROM skill_versions
     WHERE skill_id = ? AND version = ?`,
    skillId,
    version
  )) as SkillVersionRow | null;
}

async function readLatestSkillVersion(
  db: SQLiteDatabase,
  skillId: string
): Promise<SkillVersionRow | null> {
  return (await db.getFirstAsync(
    `SELECT version, manifest, manifest_hash, created_at FROM skill_versions
     WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    skillId
  )) as SkillVersionRow | null;
}

/**
 * Activates one immutable version. A version is usable only when it parses as a
 * data-only manifest and its recorded hash still matches, so no unverified or
 * mutated manifest can become active.
 */
export async function activateSkillVersion(
  db: SQLiteDatabase,
  skillId: string,
  version: string
): Promise<SkillVersionTransition> {
  const skill = (await db.getFirstAsync(
    'SELECT version FROM skills WHERE id = ?',
    skillId
  )) as { version: string } | null;
  if (!skill) throw new Error(`Skill ${skillId} not found.`);

  const row = await readSkillVersion(db, skillId, version);
  if (!row) throw new Error(`Skill ${skillId} has no immutable version ${version}.`);

  const manifest = parseVerifiedVersion(skillId, row);
  await db.runAsync(
    `UPDATE skills SET version = ?, capabilities = ?, enabled = 1, updated_at = ? WHERE id = ?`,
    manifest.version,
    JSON.stringify(toLegacySkill(manifest).capabilities),
    Date.now(),
    skillId
  );
  setLifecycleOverlay(db, skillId, manifest.version, 'active');

  return {
    skillId,
    version: manifest.version,
    previousVersion: skill.version ?? null,
    state: 'active',
  };
}

/** Rolls back to the most recent earlier immutable version, or to an explicit one. */
export async function rollbackSkillVersion(
  db: SQLiteDatabase,
  skillId: string,
  version?: string
): Promise<SkillVersionTransition> {
  const skill = (await db.getFirstAsync(
    'SELECT version FROM skills WHERE id = ?',
    skillId
  )) as { version: string } | null;
  if (!skill) throw new Error(`Skill ${skillId} not found.`);

  const current = (await readSkillVersion(db, skillId, skill.version)) ??
    (await readLatestSkillVersion(db, skillId));
  const target = version
    ? await readSkillVersion(db, skillId, version)
    : (await db.getFirstAsync(
        `SELECT version, manifest, manifest_hash, created_at FROM skill_versions
         WHERE skill_id = ? AND created_at < ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        skillId,
        current?.created_at ?? Date.now()
      )) as SkillVersionRow | null;

  if (!target) {
    throw new Error(version
      ? `Skill ${skillId} has no stored version ${version}.`
      : `Skill ${skillId} has no previous version to roll back to.`);
  }
  if (current && target.created_at >= current.created_at) {
    throw new Error(`Skill ${skillId} version ${target.version} is not a previous version.`);
  }

  const transition = await activateSkillVersion(db, skillId, target.version);
  setLifecycleOverlay(db, skillId, target.version, 'rolled_back');
  return { ...transition, state: 'rolled_back' };
}

/** Derives the lifecycle state from the stored version and its verification. */
export async function getSkillLifecycleState(
  db: SQLiteDatabase,
  skillId: string
): Promise<SkillLifecycleState | null> {
  const skill = (await db.getFirstAsync(
    'SELECT version, enabled FROM skills WHERE id = ?',
    skillId
  )) as { version: string; enabled: number } | null;
  if (!skill) return null;

  const row = await readSkillVersion(db, skillId, skill.version);
  if (!row) return 'draft';
  const overlay = lifecycleOverlays.get(db as object)?.get(skillId);
  if (overlay?.version === skill.version) return overlay.state;
  try {
    parseVerifiedVersion(skillId, row);
  } catch {
    return 'draft';
  }
  if (skill.enabled !== 1) return 'approved';

  const newer = await db.getFirstAsync(
    'SELECT 1 FROM skill_versions WHERE skill_id = ? AND created_at > ? LIMIT 1',
    skillId,
    row.created_at
  );
  return newer ? 'deprecated' : 'active';
}

export type SkillEvaluationInput = {
  skillId: string;
  version?: string;
  manifestHash?: string;
  userId?: number | null;
  taskId?: string | null;
  success: boolean;
  score?: number | null;
  detail?: Record<string, unknown> | string | null;
};

/**
 * Records an evaluation when the skill_evaluations table is available. The table
 * is owned by another workstream, so a missing table is intentionally ignored.
 */
export async function recordSkillEvaluation(
  db: SQLiteDatabase,
  input: SkillEvaluationInput
): Promise<boolean> {
  try {
    const version =
      input.version ??
      ((await db.getFirstAsync('SELECT version FROM skills WHERE id = ?', input.skillId)) as
        | { version: string }
        | null)?.version ??
      '';
    const manifestHash =
      input.manifestHash ??
      ((await db.getFirstAsync(
        'SELECT manifest_hash FROM skill_versions WHERE skill_id = ? AND version = ?',
        input.skillId,
        version
      )) as { manifest_hash: string } | null)?.manifest_hash ??
      '';
    const detail =
      typeof input.detail === 'string'
        ? input.detail.slice(0, 2_000)
        : input.detail
          ? stableJson(input.detail).slice(0, 2_000)
          : null;

    await db.runAsync(
      `INSERT INTO skill_evaluations
        (id, skill_id, version, manifest_hash, user_id, task_id, success, score, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `eval_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      input.skillId,
      version,
      manifestHash,
      input.userId ?? null,
      input.taskId ?? null,
      input.success ? 1 : 0,
      typeof input.score === 'number' && Number.isFinite(input.score) ? input.score : null,
      detail,
      Date.now()
    );
    return true;
  } catch {
    return false;
  }
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

  async activateVersion(id: string, version: string): Promise<SkillVersionTransition> {
    return activateSkillVersion(this.db, id, version);
  }

  async rollbackVersion(id: string, version?: string): Promise<SkillVersionTransition> {
    return rollbackSkillVersion(this.db, id, version);
  }

  async recordEvaluation(input: SkillEvaluationInput): Promise<boolean> {
    return recordSkillEvaluation(this.db, input);
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
      // Bind the active version so a rollback cannot be undone by a newer row.
      const stored = await db.getFirstAsync(
        `SELECT manifest FROM skill_versions WHERE skill_id = ? AND version = ?`,
        skill.id,
        skill.version
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
