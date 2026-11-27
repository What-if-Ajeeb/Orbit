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
  const row = (await db.getFirstAsync(
    `SELECT manifest, manifest_hash FROM skill_versions
     WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    skillId
  )) as { manifest: string; manifest_hash: string } | null;

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

    return {
      skillId,
      capability: capabilityName,
      input,
      output: { steps: results },
      durationMs: Date.now() - start,
      success: true,
      timestamp: start,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Skill execution failed.');
  }
}
