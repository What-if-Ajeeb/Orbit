import type { SQLiteDatabase } from 'expo-sqlite';

import { hashChain } from '../agent-runtime/hash';
import type { CapabilityGrant } from '../agent-runtime/types';
import { verifyToolCall } from '../agent-runtime/verification';
import { agentToolRegistry } from '../ai/tool-registry';
import { policyEngine } from '../policy';
import { MASTER_AGENT } from '../permissions/agents';
import { secureExecuteTool, type SecureToolSandboxGate } from '../permissions/executor';
import type { AgentIdentity } from '../permissions/types';
import { sandboxGate as defaultSandboxGate } from '../sandbox/adapters';

import {
  parseSkillManifest,
  type SkillCapabilityManifest,
  type SkillManifest,
  type SkillStep,
} from './manifest';

export type DeclarativeSkillExecution = {
  skillId: string;
  capability: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
};

export type DeclarativeSkillContext = {
  db: SQLiteDatabase;
  userId: number;
  conversationId?: number | null;
  agent?: AgentIdentity;
  projectId: string;
  projectLabel: string;
  signal?: AbortSignal;
  /** Grants are required for delegated runs and are never inherited. */
  grants?: CapabilityGrant[];
  /** Extra allowlist check, normally the active agent's tool configuration. */
  isToolAllowed?: (toolName: string) => boolean;
  sandboxGate?: SecureToolSandboxGate;
};

export async function loadSkillManifest(
  db: SQLiteDatabase,
  skillId: string
): Promise<SkillManifest | null> {
  const skill = (await db.getFirstAsync(
    'SELECT version FROM skills WHERE id = ?',
    skillId
  )) as { version: string } | null;
  const row = skill?.version
    ? ((await db.getFirstAsync(
        `SELECT manifest, manifest_hash FROM skill_versions
         WHERE skill_id = ? AND version = ?`,
        skillId,
        skill.version
      )) as { manifest: string; manifest_hash: string } | null)
    : ((await db.getFirstAsync(
        `SELECT manifest, manifest_hash FROM skill_versions
         WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        skillId
      )) as { manifest: string; manifest_hash: string } | null);

  if (!row) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.manifest);
  } catch {
    throw new Error(`Skill ${skillId} has a corrupt stored manifest.`);
  }

  const manifest = parseSkillManifest(parsed);
  if (hashChain(parsed) !== row.manifest_hash) {
    throw new Error(`Skill ${skillId} manifest failed its integrity check.`);
  }
  return manifest;
}

function valueAtPath(input: Record<string, unknown>, path: string): unknown {
  let current: unknown = input;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stepArguments(step: SkillStep, input: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = { ...(step.args ?? {}) };
  for (const [argName, inputPath] of Object.entries(step.map ?? {})) {
    const value = valueAtPath(input, inputPath);
    if (value !== undefined) args[argName] = value;
  }
  return args;
}

function isAllowed(context: DeclarativeSkillContext, toolName: string): boolean {
  if (context.isToolAllowed && !context.isToolAllowed(toolName)) return false;
  if (!context.grants) return true;

  const now = Date.now();
  return context.grants.some(
    (grant) =>
      grant.toolName === toolName &&
      grant.status !== 'revoked' &&
      (!grant.expiresAt || grant.expiresAt > now)
  );
}

function isVerifiedEnvelope(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown;
    return Boolean(parsed && typeof parsed === 'object' && (parsed as { ok?: unknown }).ok === true);
  } catch {
    return false;
  }
}

const MAX_SCHEMA_DEPTH = 6;
const MAX_SCHEMA_PROPERTIES = 50;

/**
 * Small, data-only outputSchema checker. Only `type`, `required`, `properties`,
 * `enum` and `additionalProperties: false` are interpreted; every other keyword
 * is ignored. It never executes anything supplied by a manifest.
 */
function validateOutputValue(
  schema: unknown,
  value: unknown,
  path: string,
  depth = 0
): string | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
  if (depth > MAX_SCHEMA_DEPTH) return `${path} exceeds the schema depth limit`;

  const spec = schema as Record<string, unknown>;
  if (typeof spec.type === 'string') {
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const matches =
      spec.type === 'integer'
        ? actual === 'number' && Number.isInteger(value)
        : spec.type === actual;
    if (!matches) return `${path} expected ${spec.type}`;
  }

  if (Array.isArray(spec.enum) && !spec.enum.some((entry) => entry === value)) {
    return `${path} is not an allowed value`;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const object = value as Record<string, unknown>;
  const properties =
    spec.properties && typeof spec.properties === 'object' && !Array.isArray(spec.properties)
      ? (spec.properties as Record<string, unknown>)
      : {};
  const propertyNames = Object.keys(properties);

  if (Array.isArray(spec.required)) {
    for (const key of spec.required) {
      if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(object, key)) {
        return `${path}.${key} is required`;
      }
    }
  }
  if (spec.additionalProperties === false) {
    for (const key of Object.keys(object)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        return `${path}.${key} is not allowed`;
      }
    }
  }
  if (propertyNames.length > MAX_SCHEMA_PROPERTIES) {
    return `${path} declares too many properties`;
  }
  for (const key of propertyNames) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      const issue = validateOutputValue(
        properties[key],
        object[key],
        path === '$' ? `$.${key}` : `${path}.${key}`,
        depth + 1
      );
      if (issue) return issue;
    }
  }
  return null;
}

/** Accepts the aggregate output or a step result, so both can be contracted. */
function validateOutputSchema(
  schema: Record<string, unknown> | undefined,
  candidates: Record<string, unknown>[]
): string | null {
  if (!schema) return null;
  try {
    const failures: string[] = [];
    for (const candidate of candidates) {
      const issue = validateOutputValue(schema, candidate, '$');
      if (!issue) return null;
      failures.push(issue);
    }
    return failures[0] ?? 'output did not match outputSchema';
  } catch {
    return 'outputSchema could not be evaluated safely';
  }
}

/** Executes only declarative tool mappings; no skill code is ever loaded. */
export async function executeDeclarativeSkill(
  context: DeclarativeSkillContext,
  skillId: string,
  capabilityName: string,
  input: Record<string, unknown>
): Promise<DeclarativeSkillExecution> {
  const start = Date.now();
  const fail = (error: string): DeclarativeSkillExecution => ({
    skillId,
    capability: capabilityName,
    input,
    output: {},
    durationMs: Date.now() - start,
    success: false,
    error,
    timestamp: start,
  });

  try {
    const enabledRow = await context.db.getFirstAsync(
      'SELECT enabled FROM skills WHERE id = ?',
      skillId
    ) as { enabled: number } | null;
    if (!enabledRow) return fail(`Skill ${skillId} not found.`);
    if (enabledRow.enabled !== 1) return fail(`Skill ${skillId} is disabled.`);

    const manifest = await loadSkillManifest(context.db, skillId);
    if (!manifest) {
      return fail(`Skill ${skillId} has no declarative manifest and cannot be executed.`);
    }

    const capability: SkillCapabilityManifest | undefined = manifest.capabilities.find(
      (entry) => entry.name === capabilityName
    );
    if (!capability) {
      return fail(`Capability ${capabilityName} not found in skill ${skillId}.`);
    }

    const results: Record<string, unknown>[] = [];

    for (const step of capability.steps) {
      if (!agentToolRegistry.get(step.tool)) {
        if (step.optional) continue;
        return fail(
          `Skill ${skillId} needs the ${step.tool} tool, which is not connected or enabled.`
        );
      }
      if (!isAllowed(context, step.tool)) {
        return fail(`${step.tool} is not granted to this agent.`);
      }

      const args = stepArguments(step, input);
      const rawArguments = JSON.stringify(args);
      const policy = policyEngine.evaluate(step.tool, args);
      const secured = await secureExecuteTool({
        db: context.db,
        userId: context.userId,
        agent: context.agent ?? MASTER_AGENT,
        conversationId: context.conversationId,
        projectId: context.projectId,
        projectLabel: context.projectLabel,
        toolName: step.tool,
        rawArguments,
        policy: {
          decision: policy.decision,
          ruleId: policy.ruleId,
          reason: policy.reason,
        },
        signal: context.signal,
        sandboxGate: context.sandboxGate ?? defaultSandboxGate,
        execute: (signal) =>
          agentToolRegistry.execute(
            {
              db: context.db,
              userId: context.userId,
              conversationId: context.conversationId ?? undefined,
              agent: context.agent,
              signal,
            },
            step.tool,
            rawArguments
          ),
      });

      const verification = verifyToolCall({
        toolName: step.tool,
        args,
        rawArguments,
        content: secured.content,
        success: secured.success,
        error: secured.error,
        errorCode: secured.errorCode,
        durationMs: secured.durationMs,
        trace: secured.trace,
        policyDecision: policy.decision,
        verification: {
          verified: false,
          status: 'unverified',
          reason: '',
          evidence: {},
        },
      });

      if (!secured.success || !isVerifiedEnvelope(secured.content)) {
        return {
          skillId,
          capability: capabilityName,
          input,
          output: { steps: results, failedTool: step.tool },
          durationMs: Date.now() - start,
          success: false,
          error: secured.error || `${step.tool} did not return a verified result.`,
          timestamp: start,
        };
      }

      results.push({
        tool: step.tool,
        result: JSON.parse(secured.content) as Record<string, unknown>,
        verification,
      });
    }

    const output: Record<string, unknown> = { steps: results };
    const schemaIssue = validateOutputSchema(capability.outputSchema, [
      output,
      ...results.map((result) => result.result as Record<string, unknown>),
    ]);
    if (schemaIssue) {
      return fail(`Skill ${skillId} output did not match outputSchema: ${schemaIssue}.`);
    }

    return {
      skillId,
      capability: capabilityName,
      input,
      output,
      durationMs: Date.now() - start,
      success: true,
      timestamp: start,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Skill execution failed.');
  }
}
