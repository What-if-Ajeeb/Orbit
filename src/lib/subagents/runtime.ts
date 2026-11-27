import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { runAgentTurn } from '../agent-runtime/orchestrator';
import { stableJson } from '../agent-runtime/hash';
import {
  claimAgentTask,
  createAgentTask,
  updateAgentTaskStatus,
} from '../agent-runtime/task-manager';
import type { AgentBudget, CapabilityGrant, RuntimeTurnResult } from '../agent-runtime/types';
import { verificationFailed } from '../agent-runtime/verification';
import { loadAiSettings } from '../ai/settings';
import type { ToolExecutionEvent } from '../chat-store';
import { agentIdentityForSubagent, MASTER_AGENT } from '../permissions/agents';

import { createSubagentGrants, revokeSubagentGrants } from './grants';

type SubagentRow = {
  id: string;
  name: string;
  description: string;
  capabilities: string | null;
  enabled: number;
};

export type DelegatedTaskResult = RuntimeTurnResult & {
  subagentTaskId: string;
  agentTaskId: string;
};

/**
 * Runs a child turn with a separate identity and only the explicitly requested
 * capabilities. No parent permission, tool, or memory scope is inherited.
 */
export async function runSubagentTask(
  db: SQLiteDatabase,
  options: {
    userId: number;
    userName: string;
    subagentId: string;
    instruction: string;
    requestedTools: string[];
    parentTaskId?: string;
    conversationId?: number;
    projectId?: string;
    projectLabel?: string;
    budget?: AgentBudget;
    depth?: number;
    maxDepth?: number;
    signal?: AbortSignal;
    /** Optional trace linkage supplied by an orchestrating parent. */
    traceId?: string;
    metadata?: Record<string, unknown>;
    onToolEvent?: (event: ToolExecutionEvent) => void;
  }
): Promise<DelegatedTaskResult> {
  const depth = options.depth ?? 1;
  const maxDepth = options.maxDepth ?? 1;
  if (depth > maxDepth) {
    throw new Error('The subagent depth limit was reached. No child agent was started.');
  }

  const row = (await db.getFirstAsync(
    `SELECT id, name, description, capabilities, enabled FROM subagents WHERE id = ?`,
    options.subagentId
  )) as SubagentRow | null;

  if (!row) throw new Error(`Subagent ${options.subagentId} not found.`);
  if (row.enabled !== 1) throw new Error(`Subagent ${options.subagentId} is disabled.`);

  let declaredCapabilities: string[] = [];
  try {
    const parsed = JSON.parse(row.capabilities ?? '[]') as unknown;
    declaredCapabilities = Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : [];
  } catch {
    declaredCapabilities = [];
  }

  const projectId = options.projectId ?? `subagent-${options.subagentId}`;
  const projectLabel = options.projectLabel ?? `Subagent: ${row.name}`;
  const agent = agentIdentityForSubagent(row);
  const now = Date.now();

  const metadataTraceId = typeof options.metadata?.traceId === 'string'
    ? options.metadata.traceId
    : undefined;
  const traceId = options.traceId ?? metadataTraceId;
  const traceLink = {
    ...(options.parentTaskId ? { parentTaskId: options.parentTaskId } : {}),
    ...(traceId ? { traceId } : {}),
  };
  const hasTraceLink = Object.keys(traceLink).length > 0;

  const agentTask = await createAgentTask(db, {
    userId: options.userId,
    conversationId: options.conversationId ?? null,
    projectId,
    parentTaskId: options.parentTaskId ?? null,
    subagentId: options.subagentId,
    kind: 'subagent',
    title: options.instruction.slice(0, 160),
    input: {
      instruction: options.instruction.slice(0, 4_000),
      subagentId: options.subagentId,
      requestedTools: options.requestedTools,
      ...(hasTraceLink ? { metadata: traceLink } : {}),
    },
    budget: options.budget,
  });

  const claimed = await claimAgentTask(db, agentTask.id, `subagent_${agentTask.id}`, 10 * 60_000);
  if (!claimed) {
    throw new Error('This subagent task is already running.');
  }

  const grants = await createSubagentGrants({
    db,
    userId: options.userId,
    parentTaskId: agentTask.id,
    subagentId: options.subagentId,
    declaredCapabilities,
    requestedTools: options.requestedTools,
    ttlMs: 15 * 60_000,
  });
  await db.runAsync(
    'UPDATE agent_tasks SET grants_json = ? WHERE id = ?',
    stableJson(grants),
    agentTask.id
  );

  const subagentTaskId = `subtask_${Crypto.randomUUID()}`;
  await db.runAsync(
    `INSERT INTO subagent_tasks (
      id, name, description, status, input, created_at, started_at, parent_conversation_id, agent_id
    ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
    subagentTaskId,
    `Delegated: ${row.name}`,
    options.instruction.slice(0, 500),
    stableJson({
      instruction: options.instruction,
      requestedTools: options.requestedTools,
      agentTaskId: agentTask.id,
      ...(hasTraceLink ? { metadata: traceLink } : {}),
    }),
    now,
    now,
    options.conversationId ?? null,
    MASTER_AGENT.id
  );

  try {
    const settings = await loadAiSettings();
    const result = await runAgentTurn({
      db,
      userId: options.userId,
      userName: options.userName,
      history: [{ role: 'user', content: options.instruction }],
      settings,
      conversationId: options.conversationId ?? 0,
      agent,
      projectId,
      projectLabel,
      parentTaskId: agentTask.id,
      grants: grants as CapabilityGrant[],
      budget: {
        ...options.budget,
        maxSubagentDepth: maxDepth - depth,
      },
      signal: options.signal,
      onToolEvent: options.onToolEvent,
    });

    const verified = result.status === 'completed' && result.verification.verified;
    const legacyStatus = verified ? 'completed' : 'failed';
    const error = verified ? null : 'The subagent did not return verified completion.';

    await db.runAsync(
      `UPDATE subagent_tasks SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ?`,
      legacyStatus,
      stableJson({
        reply: result.reply,
        traces: result.traces,
        taskId: result.taskId,
        status: result.status,
        verification: result.verification,
      }),
      error,
      Date.now(),
      subagentTaskId
    );

    await updateAgentTaskStatus(db, agentTask.id, result.status, {
      phase: verified ? 'done' : 'verify',
      result: {
        reply: result.reply,
        subagentTaskId,
        ...(hasTraceLink
          ? { metadata: { ...traceLink, traces: result.traces.slice(0, 20) } }
          : {}),
      },
      verification: result.verification,
      error: verified ? null : error,
      finishedAt: Date.now(),
    });

    return { ...result, subagentTaskId, agentTaskId: agentTask.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Subagent execution failed.';
    await db.runAsync(
      `UPDATE subagent_tasks SET status = 'failed', output = ?, error = ?, completed_at = ? WHERE id = ?`,
      stableJson({}),
      message,
      Date.now(),
      subagentTaskId
    );
    await updateAgentTaskStatus(db, agentTask.id, 'failed', {
      // A thrown child turn never reached a verified result; keep it in verify.
      phase: 'verify',
      result: {
        error: message,
        ...(hasTraceLink ? { metadata: traceLink } : {}),
      },
      verification: verificationFailed(message),
      error: message,
      finishedAt: Date.now(),
    });
    throw error;
  } finally {
    await revokeSubagentGrants(db, options.userId, agentTask.id, options.subagentId);
  }
}

export type SubagentDelegationOptions = Parameters<typeof runSubagentTask>[1];

export function assertSubagentVerification(result: RuntimeTurnResult): void {
  if (result.status === 'completed' && !result.verification.verified) {
    throw new Error('A subagent claimed completion without verification.');
  }
}
