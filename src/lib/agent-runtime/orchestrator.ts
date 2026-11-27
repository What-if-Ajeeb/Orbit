import type { SQLiteDatabase } from 'expo-sqlite';

import {
  defaultAgentConfig,
  filterAllowedTools,
  isToolAllowedForAgent,
  loadAgentConfig,
  newToolEventId,
  saveAgentConfig,
  type AgentConfig,
} from '../agent-settings';
import { parseArtifactToolRef } from '../ai/artifact-tools';
import { runLocalAgent, type LocalToolExecutor } from '../ai/local-agent';
import { buildSystemPrompt } from '../ai/prompt';
import { requestCompletion } from '../ai/providers';
import { isAiConfigured } from '../ai/settings';
import { agentToolRegistry, executeTool, listAgentTools } from '../ai/tools';
import { toolFail } from '../ai/tool-registry';
import type { LlmAttachment, LlmMessage } from '../ai/types';
import { getActiveBuddy } from '../buddy/store';
import type { ToolExecutionEvent } from '../chat-store';
import { buildCordisTools } from '../cordis-tools';
import { EventStore } from '../events';
import { HookEngine } from '../hooks';
import { MemoryStore } from '../memory/store';
import { buildMemoryPromptSection } from '../memory/prompt';
import { ensureMcpTools } from '../mcp/registry';
import { policyEngine, type PolicyDecision } from '../policy';
import { MASTER_AGENT } from '../permissions/agents';
import { secureExecuteTool } from '../permissions/executor';
import { redactSecrets } from '../permissions/redact';
import type { AgentIdentity } from '../permissions/types';
import { sandboxGate } from '../sandbox/adapters';
import {
  ensureBuiltinSkills,
  registerDeclarativeSkillTools,
  WEB_SEARCH_TOOL_NAME,
} from '../skills';
import { executeDeclarativeSkill } from '../skills/executor';
import { findSkillTool, type SkillManifest } from '../skills/manifest';
import { TelemetryStore } from '../telemetry';

import { BudgetExceededError, BudgetTracker, resolveBudget } from './budgets';
import { routeDeterministically } from './capability-router';
import { hashChain } from './hash';
import {
  claimAgentTask,
  createAgentTask,
  recordAgentTaskAttempt,
  updateAgentTaskStatus,
} from './task-manager';
import type {
  AgentTaskStatus,
  AgentTaskVerification,
  CapabilityGrant,
  CapabilityPlanCall,
  RuntimeToolCall,
  RuntimeTurnInput,
  RuntimeTurnResult,
} from './types';
import {
  combineVerifications,
  uncertain,
  unverified,
  verificationFailed,
  verified,
  verifyToolCall,
} from './verification';

const MAX_AI_ROUNDS = 6;

/** Carries the durable task id through a user-initiated cancellation. */
export class AgentTurnCancelledError extends Error {
  readonly taskId: string;

  constructor(message: string, taskId: string) {
    super(message);
    this.name = 'AgentTurnCancelledError';
    this.taskId = taskId;
  }
}

function isCancellationError(error: unknown): boolean {
  if (error instanceof AgentTurnCancelledError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    error.message === 'AI request cancelled.' ||
    /^(?:tool|operation|request)\s+cancelled/i.test(error.message)
  );
}

type ToolEventType =
  | 'turn_started'
  | 'turn_ended'
  | 'step_started'
  | 'step_ended'
  | 'tool_call'
  | 'tool_result'
  | 'message_added'
  | 'ai_request'
  | 'ai_response'
  | 'forked'
  | 'resumed'
  | 'paused';

type PluginActivation = {
  action: string;
  pluginId: string;
  toolNames: string[];
};

function fallbackReply(traces: string[]): string {
  if (traces.length === 0) return 'Ho gaya. Aur kuch chahiye?';
  return `Done — ${traces.join(' · ')}`;
}

const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parsePluginActivation(content: string): PluginActivation | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (
      parsed.ok !== true ||
      typeof parsed.pluginId !== 'string' ||
      typeof parsed.action !== 'string' ||
      !Array.isArray(parsed.toolNames)
    ) {
      return null;
    }

    return {
      action: parsed.action,
      pluginId: parsed.pluginId.slice(0, 120),
      toolNames: parsed.toolNames
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.slice(0, 120))
        .slice(0, 100),
    };
  } catch {
    return null;
  }
}

async function grantApprovedPluginTools(
  db: SQLiteDatabase,
  config: AgentConfig,
  activation: PluginActivation
): Promise<AgentConfig> {
  if (config.toolAccessMode === 'all' || activation.toolNames.length === 0) return config;

  const registered = new Set(
    agentToolRegistry
      .descriptors()
      .filter((descriptor) => descriptor.meta?.pluginId === activation.pluginId)
      .map((descriptor) => descriptor.definition.name)
  );
  const approved = activation.toolNames.filter(
    (name) =>
      (name.startsWith('plugin__') || name.startsWith('mcp__')) && registered.has(name)
  );

  if (approved.length === 0) return config;

  const next = Array.from(new Set([...config.allowedTools, ...approved])).sort((a, b) =>
    a.localeCompare(b)
  );

  if (next.length === config.allowedTools.length) return config;
  return saveAgentConfig(db, config.userId, config.agentId, { allowedTools: next });
}

function summarizeJson(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function deterministicReply(call: RuntimeToolCall): string {
  if (!call.success) {
    return `I could not complete ${call.toolName}. ${call.error ?? 'No reason was provided.'}`;
  }
  if (!call.verification.verified) {
    return `I ran ${call.toolName}, but it did not return a verifiable success envelope, so I can’t claim the change was completed.`;
  }

  const parsed = summarizeJson(call.content);
  switch (call.toolName) {
    case 'memory_remember':
      return 'Saved that to memory.';
    case 'memory_forget':
      return 'Removed that memory.';
    case 'memory_recall': {
      const memories = Array.isArray(parsed.memories) ? parsed.memories : [];
      return memories.length === 0
        ? 'I don’t have a matching memory for that.'
        : `Here’s what I remember: ${memories
            .slice(0, 3)
            .map((entry) => {
              const item = entry as { key?: unknown; value?: unknown };
              return `${String(item.key ?? 'memory')}: ${String(item.value ?? '')}`.slice(0, 160);
            })
            .join(' · ')}`;
    }
    case 'list_tasks': {
      const count = typeof parsed.count === 'number' ? parsed.count : 0;
      return count === 0 ? 'You have no matching tasks.' : `You have ${count} matching task${count === 1 ? '' : 's'}.`;
    }
    case 'create_task': {
      const task = parsed.task as { title?: unknown } | undefined;
      return `Created the task “${String(task?.title ?? 'untitled')}”.`;
    }
    case 'complete_task': {
      const task = parsed.task as { title?: unknown } | undefined;
      return `Marked “${String(task?.title ?? 'the task')}” complete.`;
    }
    case 'update_task': {
      const task = parsed.task as { title?: unknown } | undefined;
      return `Updated “${String(task?.title ?? 'the task')}”.`;
    }
    default:
      return `${call.toolName} completed and was verified.`;
  }
}

/** Central System-first → AI-on-demand orchestrator. */
export async function runAgentTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
  const agent: AgentIdentity = input.agent ?? MASTER_AGENT;
  const projectId = input.projectId ?? 'orbit-workspace';
  const projectLabel = input.projectLabel ?? 'Orbit workspace';
  const budget = resolveBudget(input.budget);
  const tracker = new BudgetTracker(budget);
  const db = input.db;
  const userId = input.userId;
  const conversationId = input.conversationId;
  const webSearchDisabled = input.settings.webSearch === false;

  const eventStore = new EventStore(db);
  const telemetry = new TelemetryStore(db);
  const hookEngine = new HookEngine(db);

  const emit = async (type: ToolEventType, payload: Record<string, unknown>) => {
    await eventStore.appendEvent(userId, conversationId, type, payload);
  };

  let agentConfig: AgentConfig = defaultAgentConfig(userId, agent.id);
  try {
    agentConfig = await loadAgentConfig(db, userId, agent.id);
  } catch (error) {
    console.warn('Could not load agent configuration; using safe defaults.', error);
  }

  const latestUser = [...input.history].reverse().find((item) => item.role === 'user');
  const latestText = latestUser?.content.trim() ?? '';
  const idempotencyKey = latestText
    ? hashChain({
        userId,
        conversationId,
        agentId: agent.id,
        projectId,
        text: latestText.slice(0, 4_000),
      })
    : undefined;

  const task = await createAgentTask(db, {
    userId,
    conversationId,
    projectId,
    parentTaskId: input.parentTaskId,
    subagentId: input.agent?.id.startsWith('subagent_') ? input.agent.id : null,
    kind: input.parentTaskId ? 'subagent' : 'turn',
    title: latestText.slice(0, 160) || 'Agent turn',
    input: { text: latestText.slice(0, 4_000), agentId: agent.id, projectId },
    budget,
    grants: input.grants ?? [],
    idempotencyKey,
  });

  const claimed = await claimAgentTask(db, task.id, `turn_${task.id}`, budget.maxWallMs + 60_000);
  if (!claimed) {
    throw new Error('This turn is already running. Please wait for it to finish.');
  }

  const toolEvents: ToolExecutionEvent[] = [];
  const traces: string[] = [];
  const artifactRefs = new Map<string, import('../artifacts/types').ArtifactRef>();
  const runtimeCalls: RuntimeToolCall[] = [];
  const callResults = new Map<string, string>();
  let manifests: SkillManifest[] = [];

  let reply = '';
  let mode: RuntimeTurnResult['mode'] = 'system';
  let finalStatus: AgentTaskStatus = 'running';
  let finalVerification: AgentTaskVerification = unverified('The turn has not finished verification.');
  let rethrow: unknown = null;

  const isGranted = (grant: CapabilityGrant): boolean =>
    (grant.status ?? 'active') !== 'revoked' && (!grant.expiresAt || grant.expiresAt > Date.now());

  const allowedTool = (toolName: string): boolean => {
    if (!agentToolRegistry.get(toolName)) return false;
    if (!isToolAllowedForAgent(agentConfig, toolName)) return false;
    if (input.grants) {
      return input.grants.some((grant) => grant.toolName === toolName && isGranted(grant));
    }
    return true;
  };

  const localExecute: LocalToolExecutor = async (toolName, args) => {
    const runtimeCall = await executeCapabilityCall({ toolName, args });
    return {
      content: runtimeCall.content,
      success: runtimeCall.success,
      error: runtimeCall.error,
      trace: runtimeCall.trace,
    };
  };

  async function executeCapabilityCall(call: CapabilityPlanCall): Promise<RuntimeToolCall> {
    tracker.consumeToolCall();
    const startedAt = Date.now();
    const args = call.args ?? {};
    const rawArguments = JSON.stringify(args);
    const running: ToolExecutionEvent = {
      id: newToolEventId(),
      toolName: call.toolName,
      status: 'running',
      startedAt,
      summary: `Running ${call.toolName}`,
    };
    toolEvents.push(running);
    input.onToolEvent?.(running);

    let content = toolFail(`${call.toolName} is not enabled for this agent.`);
    let success = false;
    let error = `${call.toolName} is not enabled for this agent.`;
    let errorCode: string | undefined;
    let durationMs = 0;
    let trace = '';
    let policyDecision: PolicyDecision = 'deny';

    if (!allowedTool(call.toolName)) {
      const denied: ToolExecutionEvent = {
        ...running,
        status: 'denied',
        endedAt: Date.now(),
        durationMs: 0,
        summary: `${call.toolName} was blocked.`,
        detail: error,
      };
      toolEvents[toolEvents.indexOf(running)] = denied;
      input.onToolEvent?.(denied);
      await emit('tool_call', {
        toolName: call.toolName,
        agentId: agent.id,
        rawArguments: redactSecrets(rawArguments).slice(0, 2_000),
        unauthorized: true,
      });
      await emit('tool_result', { toolName: call.toolName, success: false, denied: true });
      await telemetry.recordToolCall(
        userId,
        conversationId,
        call.toolName,
        0,
        null,
        null,
        null,
        false,
        'deny',
        error
      );
    } else {
      const policy = policyEngine.evaluate(call.toolName, args);
      policyDecision = policy.decision;
      running.policyDecision = policyDecision;
      input.onToolEvent?.(running);
      await emit('tool_call', {
        toolName: call.toolName,
        agentId: agent.id,
        agentName: agent.name,
        rawArguments: redactSecrets(rawArguments).slice(0, 2_000),
      });

      const skillTool = findSkillTool(call.toolName, manifests);
      if (skillTool) {
        const execution = await executeDeclarativeSkill(
          {
            db,
            userId,
            conversationId,
            agent,
            projectId,
            projectLabel,
            signal: input.signal,
            grants: input.grants,
            isToolAllowed: allowedTool,
            sandboxGate,
          },
          skillTool.manifest.id,
          skillTool.capability.name,
          args
        );
        durationMs = execution.durationMs;
        success = execution.success;
        error = execution.error ?? '';
        trace = `Skill ${skillTool.manifest.name} → ${skillTool.capability.name}`;
        content = JSON.stringify({
          ok: execution.success,
          ...execution.output,
          ...(execution.error ? { error: execution.error } : {}),
        });
      } else {
        const secured = await secureExecuteTool({
          db,
          userId,
          agent,
          conversationId,
          projectId,
          projectLabel,
          toolName: call.toolName,
          rawArguments,
          policy: {
            decision: policy.decision,
            ruleId: policy.ruleId,
            reason: policy.reason,
          },
          timeoutMs: agentToolRegistry.get(call.toolName)?.timeoutMs,
          signal: input.signal,
          sandboxGate,
          execute: (signal) =>
            executeTool(db, userId, call.toolName, rawArguments, conversationId, signal, agent),
        });
        content = secured.content;
        trace = secured.trace;
        success = secured.success;
        error = secured.error ?? '';
        errorCode = secured.errorCode;
        durationMs = secured.durationMs;
      }

      const finished: ToolExecutionEvent = {
        ...running,
        status: success ? 'success' : 'error',
        endedAt: Date.now(),
        durationMs,
        summary: success
          ? `${call.toolName} completed.`
          : `${call.toolName} failed.`,
        ...(error || trace ? { detail: redactSecrets(error || trace).slice(0, 800) } : {}),
      };
      toolEvents[toolEvents.indexOf(running)] = finished;
      input.onToolEvent?.(finished);

      await telemetry.recordToolCall(
        userId,
        conversationId,
        call.toolName,
        durationMs,
        null,
        null,
        null,
        success,
        policyDecision,
        errorCode ? `${errorCode}: ${error ?? ''}` : error
      );
      await emit('tool_result', {
        toolName: call.toolName,
        durationMs,
        success,
        error,
        errorCode,
        resultLength: content.length,
        policy: policyDecision,
        rule: policy.ruleName,
        permission: { allowed: success },
      });
    }

    if (trace) traces.push(trace);
    if (success) callResults.set(call.toolName, content);

    if (success && call.toolName.startsWith('artifact_')) {
      const ref = parseArtifactToolRef(content);
      if (ref) artifactRefs.set(ref.id, ref);
    }

    if (success && call.toolName === 'orbit_plugin_request') {
      const activation = parsePluginActivation(content);
      if (activation && activation.action !== 'reused') {
        agentConfig = await grantApprovedPluginTools(db, agentConfig, activation);
      }
    }

    const runtimeCall: RuntimeToolCall = {
      toolName: call.toolName,
      args,
      rawArguments,
      content,
      success,
      error,
      errorCode,
      durationMs,
      trace,
      policyDecision,
      verification: unverified('Pending verification.'),
    };
    runtimeCall.verification = verifyToolCall(runtimeCall);
    runtimeCalls.push(runtimeCall);

    await recordAgentTaskAttempt(db, {
      taskId: task.id,
      attempt: runtimeCalls.length,
      toolName: call.toolName,
      status: success ? 'success' : 'failed',
      startedAt,
      finishedAt: Date.now(),
      durationMs,
      errorCode: errorCode ?? null,
      error: error ?? null,
      verification: runtimeCall.verification,
      metadata: { policy: policyDecision, subagent: agent.id !== MASTER_AGENT.id },
    });

    return runtimeCall;
  }

  try {
    await emit('turn_started', {
      mode: 'system-first',
      model: input.settings.model,
      provider: input.settings.provider,
      agentId: agent.id,
      agentName: agent.name,
      projectId,
      taskId: task.id,
    });

    await hookEngine.executeHook('before_agent_turn', {
      userId,
      conversationId,
      timestamp: Date.now(),
      taskId: task.id,
    });

    await ensureMcpTools();
    try {
      await ensureBuiltinSkills(db);
    } catch (error) {
      console.warn('Could not seed declarative skills.', error);
    }
    manifests = await registerDeclarativeSkillTools(db, { webSearchDisabled });

    try {
      const imported = await new MemoryStore(db).importLegacyMemory(userId, agent.id, agentConfig.memory);
      if (imported) {
        agentConfig = await saveAgentConfig(db, userId, agent.id, { memory: '' });
      }
    } catch (error) {
      console.warn('Could not import legacy agent memory.', error);
    }

    let buddyCtx: { buddy: NonNullable<Awaited<ReturnType<typeof getActiveBuddy>>> } | undefined;
    try {
      const activeBuddy = await getActiveBuddy(db, userId);
      if (activeBuddy) buddyCtx = { buddy: activeBuddy };
    } catch (error) {
      console.warn('Could not load active buddy for prompt.', error);
    }

    const route = routeDeterministically({ text: latestText, agentConfig });

    if (route.kind === 'denied') {
      mode = 'system';
      reply = `I couldn’t do that: ${route.reason}`;
      finalVerification = verificationFailed(route.reason, { toolName: route.toolName ?? null });
      finalStatus = 'failed';
    } else {
      if (route.kind === 'handled' || route.kind === 'partial') {
        for (const call of route.calls) {
          await executeCapabilityCall(call);
        }
      }

      const systemVerification = combineVerifications(
        runtimeCalls.map((call) => call.verification),
        'No deterministic tool was required.'
      );

      if (route.kind === 'handled') {
        mode = 'system';
        const allVerified = runtimeCalls.length > 0 && runtimeCalls.every((call) => call.success && call.verification.verified);
        finalVerification = systemVerification;
        finalStatus = allVerified ? 'completed' : 'needs_review';
        reply = runtimeCalls.length === 1
          ? deterministicReply(runtimeCalls[0])
          : runtimeCalls.map(deterministicReply).join(' ');
      } else if (!isAiConfigured(input.settings)) {
        mode = 'local';
        const local = await runLocalAgent(db, userId, latestText, localExecute);
        finalVerification = runtimeCalls.length > 0
          ? combineVerifications(runtimeCalls.map((call) => call.verification))
          : local.traces.length > 0
            ? unverified('Local mode completed without a verifiable tool envelope.')
            : verified('A local reply was generated; no state-changing action was claimed.');
        finalStatus = finalVerification.verified ? 'completed' : 'needs_review';
        reply = local.traces.length > 0 && !finalVerification.verified
          ? `${local.reply} (I couldn’t verify every change.)`
          : local.reply;
        traces.push(...local.traces);
      } else {
        mode = 'ai';
        const verifiedContext = await buildMemoryPromptSection(db, userId, agent.id, projectId);
        const verifiedResults = runtimeCalls
          .filter((call) => call.success && call.verification.verified)
          .map((call) => `- ${call.toolName}: ${redactSecrets(call.content).slice(0, 500)}`);
        const memoryAndResults = [verifiedContext, ...verifiedResults].filter(Boolean).join('\n');

        let toolDefinitions = filterAllowedTools(listAgentTools(), agentConfig);
        if (input.grants) {
          toolDefinitions = toolDefinitions.filter((definition) => allowedTool(definition.name));
        }
        if (webSearchDisabled) {
          toolDefinitions = toolDefinitions.filter((definition) => definition.name !== WEB_SEARCH_TOOL_NAME);
        }

        if (input.creatorMode) {
          for (const tool of buildCordisTools(db)) {
            agentToolRegistry.register(tool, { replace: true });
            if (allowedTool(tool.definition.name)) toolDefinitions.push(tool.definition);
          }
        }

        const messages: LlmMessage[] = [
          {
            role: 'system',
            content: buildSystemPrompt(input.userName, agent.name, Date.now(), buddyCtx, {
              instructions: agentConfig.instructions,
              memory: agentConfig.memory,
              verifiedContext: memoryAndResults,
            }),
          },
          ...input.history
            .filter((item) => item.content.trim().length > 0 || (item.attachments?.length ?? 0) > 0)
            .slice(-20)
            .map((item) =>
              (item.role === 'user'
                ? {
                    role: 'user',
                    content: item.content,
                    ...(item.attachments && item.attachments.length > 0
                      ? { attachments: item.attachments as LlmAttachment[] }
                      : {}),
                  }
                : { role: 'assistant', content: item.content }) as LlmMessage
            ),
        ];

        let aiText = '';
        for (let round = 0; round < MAX_AI_ROUNDS; round += 1) {
          tracker.assertActive();
          if (input.signal?.aborted) throw new Error('AI request cancelled.');
          await emit('step_started', { round });

          const requestTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
          tracker.consumeTokens(requestTokens, 0);
          await emit('ai_request', { tokensIn: requestTokens, messageCount: messages.length });

          const turn = await requestCompletion(input.settings, messages, toolDefinitions, {
            onTextDelta: input.onTextDelta,
            signal: input.signal,
          });

          const outputTokens = estimateTokens(turn.text ?? '');
          tracker.consumeTokens(0, outputTokens);
          aiText = turn.text ?? '';
          await emit('ai_response', { tokensOut: outputTokens, replyLength: aiText.length });

          if (turn.toolCalls.length === 0) {
            await emit('step_ended', { round, toolCalls: 0 });
            break;
          }

          messages.push({
            role: 'assistant',
            content: turn.text,
            toolCalls: turn.toolCalls,
          });

          for (const modelCall of turn.toolCalls) {
            const call = await executeCapabilityCall({
              toolName: modelCall.name,
              args: parseToolArguments(modelCall.arguments),
            });
            messages.push({
              role: 'tool',
              toolCallId: modelCall.id,
              name: modelCall.name,
              content: call.content,
            });
          }

          await emit('step_ended', { round, toolCalls: turn.toolCalls.length });
          toolDefinitions = filterAllowedTools(listAgentTools(), agentConfig);
          if (input.grants) {
            toolDefinitions = toolDefinitions.filter((definition) => allowedTool(definition.name));
          }
          if (webSearchDisabled) {
            toolDefinitions = toolDefinitions.filter((definition) => definition.name !== WEB_SEARCH_TOOL_NAME);
          }
        }

        finalVerification = runtimeCalls.length === 0
          ? verified('The reply was conversational; no state-changing action was claimed.')
          : combineVerifications(runtimeCalls.map((call) => call.verification));
        finalStatus = finalVerification.verified ? 'completed' : 'needs_review';
        reply = aiText || fallbackReply(traces);
        if (!finalVerification.verified && runtimeCalls.length > 0) {
          reply = `I couldn’t verify every action. ${reply}`;
        }
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    const cancelled = isCancellationError(error);

    if (runtimeCalls.length > 0) {
      rethrow = cancelled ? new AgentTurnCancelledError(reason, task.id) : null;
      finalStatus = 'needs_review';
      finalVerification = cancelled
        ? uncertain(`Stopped before verification. Task ${task.id} needs review.`, {
            interrupted: true,
            taskId: task.id,
          })
        : uncertainOrFailed(reason);
      reply = cancelled
        ? `Stopped before verification. Earlier actions may have happened, so task ${task.id} needs review.`
        : `Your changes may have been saved, but the turn stopped before verification. (${reason})`;
    } else {
      rethrow = cancelled ? new AgentTurnCancelledError(reason, task.id) : error;
      finalStatus = cancelled ? 'cancelled' : 'failed';
      finalVerification = cancelled
        ? verificationFailed(`Task ${task.id} was cancelled before verification.`, {
            interrupted: true,
            taskId: task.id,
          })
        : verificationFailed(reason);
      reply = cancelled ? `Stopped before completion. Task ${task.id} was cancelled.` : reason;
    }
  }

  await emit('turn_ended', {
    status: finalStatus,
    verified: finalVerification.verified,
    taskId: task.id,
    toolCalls: runtimeCalls.length,
  });
  await hookEngine.executeHook('after_agent_turn', {
    userId,
    conversationId,
    timestamp: Date.now(),
    success: finalStatus === 'completed',
    taskId: task.id,
  });

  await updateAgentTaskStatus(db, task.id, finalStatus, {
    phase: finalStatus === 'completed' ? 'done' : 'verify',
    result: reply ? { reply, taskId: task.id } : null,
    verification: finalVerification,
    error: finalStatus === 'failed' || finalStatus === 'needs_review' ? reply : null,
    finishedAt: Date.now(),
    leaseOwner: null,
    leaseUntil: null,
  });

  if (rethrow) {
    await hookEngine.executeHook('on_error', {
      userId,
      conversationId,
      timestamp: Date.now(),
      error: rethrow instanceof Error ? rethrow.message : String(rethrow),
      taskId: task.id,
    });
    throw rethrow;
  }

  return {
    reply,
    traces,
    artifacts: Array.from(artifactRefs.values()),
    toolEvents,
    mode,
    taskId: task.id,
    status: finalStatus,
    verification: finalVerification,
  };
}

function uncertainOrFailed(reason: string): AgentTaskVerification {
  return {
    verified: false,
    status: 'uncertain',
    reason,
    evidence: { interrupted: true },
  };
}

// Keep the error type referenced so budget failures are intentionally typed in
// tests and callers without changing the public API.
export { BudgetExceededError };
