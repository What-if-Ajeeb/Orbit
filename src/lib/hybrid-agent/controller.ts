import type { SQLiteDatabase } from 'expo-sqlite';

import {
  defaultAgentConfig,
  filterAllowedTools,
  isToolAllowedForAgent,
  loadAgentConfig,
  saveAgentConfig,
  type AgentConfig,
} from '../agent-settings';
import { parseArtifactToolRef } from '../ai/artifact-tools';
import { runLocalAgent, type LocalToolExecutor } from '../ai/local-agent';
import { agentToolRegistry, listAgentTools } from '../ai/tools';
import type { LlmAttachment, LlmMessage } from '../ai/types';
import { getActiveBuddy } from '../buddy/store';
import type { ToolExecutionEvent } from '../chat-store';
import { getChatStore } from '../chat';
import { buildCordisTools } from '../cordis-tools';
import { EventStore } from '../events';
import {
  buildHermesPromptBundle,
  buildToolsets,
  isProviderCancellationError,
  isSmallTalk,
  requestCompletionWithSystemFallback,
  searchHermesSession,
  selectScheduledBundles,
  smallTalkReply,
  summarizeProviderRoute,
  type HermesSessionHit,
} from '../hermes';
import { HookEngine } from '../hooks';
import { MemoryStore } from '../memory/store';
import { ensureMcpTools } from '../mcp/registry';
import { policyEngine } from '../policy';
import { MASTER_AGENT } from '../permissions/agents';
import { redactSecrets } from '../permissions/redact';
import type { AgentIdentity } from '../permissions/types';
import {
  ensureBuiltinSkills,
  registerDeclarativeSkillTools,
  WEB_SEARCH_TOOL_NAME,
} from '../skills';
import type { SkillManifest } from '../skills/manifest';
import { TelemetryStore } from '../telemetry';

import { BudgetExceededError, BudgetTracker, resolveBudget } from '../agent-runtime/budgets';
import { hashChain } from '../agent-runtime/hash';
import {
  claimAgentTask,
  createAgentTask,
  recordAgentTaskAttempt,
  updateAgentTaskStatus,
} from '../agent-runtime/task-manager';
import type {
  AgentTaskStatus,
  AgentTaskVerification,
  CapabilityGrant,
  CapabilityPlanCall,
  RuntimeToolCall,
  RuntimeTurnInput,
  RuntimeTurnResult,
} from '../agent-runtime/types';
import {
  combineVerifications,
  uncertain,
  unverified,
  verificationFailed,
} from '../agent-runtime/verification';

import { hasLocalFallback, shouldUseAi, MAX_HYBRID_AI_ROUNDS } from './ai-router';
import { recordHybridEvent, newHybridTraceId, traceContext } from './audit';
import { buildApprovalBinding, enterApprovalWait, resolveApprovalWait } from './approvals';
import { buildCapabilityCatalog } from './capability-catalog';
import { dispatchCapabilityCall } from './dispatcher';
import { routeIntent } from './intent-router';
import { buildPlan, planIsProhibited } from './planner';
import { decideRisk } from './risk-controller';
import { assertTransition, toLegacyStatus } from './state';
import type {
  AutonomyDecision,
  CapabilityDescriptor,
  HybridIntent,
  HybridPlan,
  HybridPlanStep,
  HybridRiskDecision,
  HybridTaskState,
  HybridTraceContext,
} from './types';
import { conversationalVerification, verificationToState } from './verification';

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
    isProviderCancellationError(error) ||
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

function resourceKeyFor(args: Record<string, unknown>): string {
  for (const key of ['key', 'task_id', 'id', 'path', 'file_path', 'url', 'recipient', 'to', 'target']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 240);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function uncertainOrFailed(reason: string): AgentTaskVerification {
  return uncertain(reason, { interrupted: true });
}

/**
 * Central SYSTEM-FIRST → AI-ON-DEMAND → RISK-BASED AUTONOMY loop.
 *
 * The planner is deterministic and bounded. AI may propose capabilities, but
 * every capability still passes the same catalog, policy, approval and sandbox
 * boundary before it can run.
 */
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
  const policyVersion = policyEngine.evaluatePolicyForExecution('', {}).policyVersion;

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

  const trace: HybridTraceContext = traceContext(newHybridTraceId());
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
    hybridState: 'QUEUED',
    traceId: trace.traceId,
  });
  trace.taskId = task.id;

  const claimed = await claimAgentTask(db, task.id, `turn_${task.id}`, budget.maxWallMs + 60_000);
  if (!claimed) {
    throw new Error('This turn is already running. Please wait for it to finish.');
  }

  const runtimeState: { value: HybridTaskState } = { value: 'QUEUED' };
  // A function boundary keeps control-flow narrowing from treating a state
  // mutation inside an approval helper as impossible.
  const stateIsBlocked = (): boolean => (runtimeState.value as HybridTaskState) === 'BLOCKED';
  const toolEvents: ToolExecutionEvent[] = [];
  const traces: string[] = [];
  const artifactRefs = new Map<string, import('../artifacts/types').ArtifactRef>();
  const runtimeCalls: RuntimeToolCall[] = [];
  let manifests: SkillManifest[] = [];
  let catalog: CapabilityDescriptor[] = [];
  let intent: HybridIntent = {
    kind: 'conversation',
    confidence: 0,
    calls: [],
    notes: [],
    decision: 'NEEDS_AI',
  };

  let reply = '';
  let mode: RuntimeTurnResult['mode'] = 'system';
  let finalStatus: AgentTaskStatus = 'running';
  let finalHybridState: HybridTaskState = 'RUNNING';
  let finalVerification: AgentTaskVerification = unverified('The turn has not finished verification.');
  let rethrow: unknown = null;

  const transition = async (next: HybridTaskState, status: AgentTaskStatus, patch: Record<string, unknown> = {}) => {
    assertTransition(runtimeState.value, next);
    runtimeState.value = next;
    await updateAgentTaskStatus(db, task.id, status, {
      ...patch,
      hybridState: next,
      traceId: trace.traceId,
    } as Parameters<typeof updateAgentTaskStatus>[3]);
  };

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

  async function executeCapabilityCall(
    call: CapabilityPlanCall,
    options: { step?: HybridPlanStep; forceApproval?: boolean } = {}
  ): Promise<RuntimeToolCall> {
    tracker.consumeToolCall();

    const evaluation = policyEngine.evaluatePolicyForExecution(call.toolName, call.args ?? {});
    const risk: HybridRiskDecision = options.step
      ? {
          decision: options.step.decision,
          risk: options.step.risk,
          reason: options.step.notes?.join(' ') ?? 'Planned capability step.',
          operationFingerprint: options.step.operationFingerprint,
          requiresFreshConfirmation: options.step.decision === 'APPROVAL_REQUIRED',
        }
      : decideRisk({
          intent,
          toolName: call.toolName,
          args: call.args ?? {},
          policy: evaluation,
          capability: catalog.find((entry) => entry.name === call.toolName) ?? null,
          policyVersion,
        });

    if (risk.decision === 'PROHIBITED') {
      const reason = `${call.toolName} is prohibited by the deterministic safety policy.`;
      await recordHybridEvent(db, {
        traceId: trace.traceId,
        taskId: task.id,
        userId,
        source: 'controller',
        type: 'capability.prohibited',
        payload: { toolName: call.toolName, reason },
      });
      throw new Error(reason);
    }

    const forceApproval = options.forceApproval ?? risk.decision === 'APPROVAL_REQUIRED';
    const stepId = options.step?.id ?? risk.operationFingerprint.slice(0, 24);
    const binding = forceApproval
      ? buildApprovalBinding({
          taskId: task.id,
          stepId,
          toolName: call.toolName,
          args: call.args ?? {},
          risk,
          scopeKey: projectId,
          resourceKey: resourceKeyFor(call.args ?? {}),
          policyVersion,
        })
      : null;
    const approvalId = binding
      ? await enterApprovalWait({ db, taskId: task.id, userId, binding, trace })
      : null;
    if (binding) {
      runtimeState.value = 'WAITING_FOR_APPROVAL';
      await updateAgentTaskStatus(db, task.id, 'awaiting_approval', {
        hybridState: runtimeState.value,
        traceId: trace.traceId,
      });
    }

    let result: Awaited<ReturnType<typeof dispatchCapabilityCall>>;
    try {
      result = await dispatchCapabilityCall(
        { toolName: call.toolName, args: call.args ?? {} },
        {
          db,
          userId,
          conversationId,
          agent,
          projectId,
          projectLabel,
          taskId: task.id,
          signal: input.signal,
          grants: input.grants,
          manifests,
          allowedTool,
          onToolEvent: input.onToolEvent,
          emit,
          telemetry,
          trace,
          policyEvaluation: evaluation,
          forceApproval,
        }
      );
    } catch (error) {
      if (approvalId && binding) {
        const state = await resolveApprovalWait({
          db,
          approvalId,
          taskId: task.id,
          userId,
          binding,
          trace,
          granted: false,
          permissionRequestId: null,
        });
        runtimeState.value = state === 'approved' ? 'RUNNING' : 'BLOCKED';
      }
      throw error;
    }

    if (approvalId && binding) {
      // The approval ledger records the user's decision, not the later
      // verification outcome; an unverified result stays unverified on the task.
      const granted = result.permissionAllowed === true;
      const state = await resolveApprovalWait({
        db,
        approvalId,
        taskId: task.id,
        userId,
        binding,
        trace,
        granted,
        permissionRequestId: result.permissionRequestId,
      });
      runtimeState.value = state === 'approved' ? 'RUNNING' : 'BLOCKED';
    }

    toolEvents.push(...result.toolEvents);
    if (result.trace) traces.push(result.trace);
    if (result.success) {
      if (result.toolName.startsWith('artifact_')) {
        const ref = parseArtifactToolRef(result.content);
        if (ref) artifactRefs.set(ref.id, ref);
      }
      if (result.toolName === 'orbit_plugin_request') {
        const activation = parsePluginActivation(result.content);
        if (activation && activation.action !== 'reused') {
          agentConfig = await grantApprovedPluginTools(db, agentConfig, activation);
        }
      }
    }

    const {
      toolEvents: _toolEvents,
      policyRuleId: _policyRuleId,
      policyRuleName: _policyRuleName,
      permissionRequestId: _permissionRequestId,
      permissionAllowed: _permissionAllowed,
      stepId: _stepId,
      ...runtimeCall
    } = result;
    runtimeCalls.push(runtimeCall);

    await recordAgentTaskAttempt(db, {
      taskId: task.id,
      attempt: runtimeCalls.length,
      toolName: runtimeCall.toolName,
      status: runtimeCall.success ? 'success' : 'failed',
      startedAt: Date.now() - runtimeCall.durationMs,
      finishedAt: Date.now(),
      durationMs: runtimeCall.durationMs,
      errorCode: runtimeCall.errorCode ?? null,
      error: runtimeCall.error ?? null,
      verification: runtimeCall.verification,
      traceId: trace.traceId,
      stepId,
      metadata: {
        hybridState: runtimeState.value,
        policy: runtimeCall.policyDecision ?? null,
        policyVersion,
        subagent: agent.id !== MASTER_AGENT.id,
      },
    });

    await recordHybridEvent(db, {
      traceId: trace.traceId,
      taskId: task.id,
      userId,
      source: 'controller',
      type: 'task.attempt',
      payload: {
        toolName: runtimeCall.toolName,
        stepId,
        success: runtimeCall.success,
        verified: runtimeCall.verification.verified,
      },
    });

    return runtimeCall;
  }

  const localExecute: LocalToolExecutor = async (toolName, args) => {
    const runtimeCall = await executeCapabilityCall({ toolName, args });
    return {
      content: runtimeCall.content,
      success: runtimeCall.success,
      error: runtimeCall.error,
      trace: runtimeCall.trace,
    };
  };

  try {
    await emit('turn_started', {
      mode: 'system-first',
      model: input.settings.model,
      provider: input.settings.provider,
      agentId: agent.id,
      agentName: agent.name,
      projectId,
      taskId: task.id,
      traceId: trace.traceId,
      policyVersion,
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
    catalog = buildCapabilityCatalog({
      agentConfig,
      grants: input.grants,
      skillNames: manifests.flatMap((manifest) =>
        manifest.capabilities.map((capability) => `${manifest.id}_${capability.name}`)
      ),
    });

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

    await transition('PLANNING', 'running', { phase: 'system' });
    intent = routeIntent({ text: latestText, agentConfig });
    await recordHybridEvent(db, {
      traceId: trace.traceId,
      taskId: task.id,
      userId,
      source: 'controller',
      type: 'plan.intent',
      payload: {
        kind: intent.kind,
        decision: intent.decision,
        confidence: intent.confidence,
        notes: intent.notes,
      },
    });

    const { plan }: { plan: HybridPlan } = buildPlan({
      goal: latestText.slice(0, 4_000),
      calls: intent.calls,
      notes: intent.notes,
      policy: policyEngine.evaluatePolicyForExecution('', {}),
      evaluatePolicy: (toolName, args) => policyEngine.evaluatePolicyForExecution(toolName, args),
      policyVersion,
      catalog,
      createdAt: Date.now(),
    });

    await updateAgentTaskStatus(db, task.id, 'running', {
      phase: 'system',
      hybridState: runtimeState.value,
      traceId: trace.traceId,
      plan: plan as unknown as Record<string, unknown>,
    } as Parameters<typeof updateAgentTaskStatus>[3]);
    await recordHybridEvent(db, {
      traceId: trace.traceId,
      taskId: task.id,
      userId,
      source: 'controller',
      type: 'plan.created',
      payload: {
        steps: plan.steps.map((step) => ({
          id: step.id,
          toolName: step.toolName,
          decision: step.decision,
          risk: step.risk,
        })),
      },
    });

    if (intent.decision === 'PROHIBITED' || planIsProhibited(plan)) {
      mode = 'system';
      const reason =
        intent.notes[0] ?? plan.rejected[0]?.reason ?? 'The request is prohibited by policy.';
      reply = `I couldn’t do that: ${reason}`;
      finalVerification = verificationFailed(reason);
      finalHybridState = 'FAILED';
      await recordHybridEvent(db, {
        traceId: trace.traceId,
        taskId: task.id,
        userId,
        source: 'controller',
        type: 'plan.prohibited',
        payload: { reason },
      });
    } else {
      await transition('RUNNING', 'running', { phase: 'system' });
      let blocked = false;

      for (const step of plan.steps) {
        if (stateIsBlocked()) {
          blocked = true;
          break;
        }
        if (step.decision === 'PROHIBITED') {
          blocked = true;
          break;
        }
        const call = await executeCapabilityCall(
          { toolName: step.toolName, args: step.args },
          { step }
        );
        if (stateIsBlocked() || !call.success) {
          blocked = true;
          break;
        }
      }

      // Hermes-style system deferral: small talk never reaches a model, even
      // when a provider is configured. It produces a deterministic reply and
      // leaves the task in the system path.
      const deferToSystem =
        intent.decision === 'NEEDS_AI' && runtimeCalls.length === 0 && isSmallTalk(latestText);
      const useAi = shouldUseAi({ intent, settings: input.settings }) && !deferToSystem;
      const useLocal =
        !useAi && (hasLocalFallback({ intent, settings: input.settings }) || deferToSystem);

      if (!blocked && intent.decision === 'NEEDS_AI' && (useAi || useLocal)) {
        if (useLocal) {
          mode = deferToSystem ? 'system' : 'local';
          const local = deferToSystem
            ? { reply: smallTalkReply(latestText) ?? '', traces: [] as string[] }
            : await runLocalAgent(db, userId, latestText, localExecute);
          finalVerification =
            runtimeCalls.length > 0
              ? combineVerifications(runtimeCalls.map((call) => call.verification))
              : local.traces.length > 0
                ? unverified('Local mode completed without a verifiable tool envelope.')
                : conversationalVerification();
          reply = local.traces.length > 0 && !finalVerification.verified
            ? `${local.reply} (I couldn’t verify every change.)`
            : local.reply;
          traces.push(...local.traces);
        } else {
          mode = 'ai';
          let toolDefinitions = filterAllowedTools(listAgentTools(), agentConfig);
          if (input.grants) {
            toolDefinitions = toolDefinitions.filter((definition) => allowedTool(definition.name));
          }
          if (webSearchDisabled) {
            toolDefinitions = toolDefinitions.filter(
              (definition) => definition.name !== WEB_SEARCH_TOOL_NAME
            );
          }

          if (input.creatorMode) {
            for (const tool of buildCordisTools(db)) {
              agentToolRegistry.register(tool, { replace: true });
              if (allowedTool(tool.definition.name)) toolDefinitions.push(tool.definition);
            }
          }

          const toolsets = buildToolsets({
            agentConfig,
            grants: input.grants,
            toolNames: toolDefinitions.map((definition) => definition.name),
          });
          const providerRoute = summarizeProviderRoute(input.settings);
          let sessionHits: HermesSessionHit[] = [];
          if (conversationId) {
            try {
              sessionHits = await searchHermesSession({
                store: getChatStore(db),
                userId,
                conversationId,
                query: latestText,
                limit: 6,
              });
            } catch (error) {
              console.warn('Could not recall bounded session history.', error);
            }
          }
          const promptBundle = await buildHermesPromptBundle({
            db,
            userId,
            agentId: agent.id,
            projectId,
            userName: input.userName,
            agentName: agent.name,
            buddyCtx,
            instructions: agentConfig.instructions,
            memoryNotes: agentConfig.memory,
            verifiedResults: runtimeCalls
              .filter((call) => call.success && call.verification.verified)
              .map((call) => `- ${call.toolName}: ${redactSecrets(call.content).slice(0, 500)}`),
            manifests,
            ...(input.skillBundleIds && input.skillBundleIds.length > 0
              ? { bundles: selectScheduledBundles(input.skillBundleIds) }
              : {}),
            availableTools: new Set(toolDefinitions.map((definition) => definition.name)),
            availableToolsets: new Set(
              toolsets.filter((descriptor) => descriptor.available.length > 0).map((descriptor) => descriptor.id)
            ),
            webSearchDisabled,
            toolsetIds: toolsets.map((descriptor) => descriptor.id),
            sessionHits,
          });
          await recordHybridEvent(db, {
            traceId: trace.traceId,
            taskId: task.id,
            userId,
            source: 'controller',
            type: 'prompt.frozen',
            payload: {
              snapshotId: promptBundle.snapshotId,
              tiers: promptBundle.tiers,
              provider: providerRoute.provider,
              route: providerRoute.kind,
              routeSummary: providerRoute,
              skillBundleIds: input.skillBundleIds ?? [],
            },
          });

          const messages: LlmMessage[] = [
            {
              role: 'system',
              content: promptBundle.system,
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
          for (let round = 0; round < MAX_HYBRID_AI_ROUNDS; round += 1) {
            tracker.assertActive();
            if (input.signal?.aborted) throw new Error('AI request cancelled.');
            await emit('step_started', { round, traceId: trace.traceId });

            const requestTokens = messages.reduce(
              (sum, message) => sum + estimateTokens(message.content),
              0
            );
            tracker.consumeTokens(requestTokens, 0);
            await emit('ai_request', { tokensIn: requestTokens, messageCount: messages.length });

            const completion = await requestCompletionWithSystemFallback({
              settings: input.settings,
              messages,
              tools: toolDefinitions,
              options: {
                ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
                ...(input.signal ? { signal: input.signal } : {}),
              },
              snapshotId: promptBundle.snapshotId,
            });
            const turn = completion.turn;
            await recordHybridEvent(db, {
              traceId: trace.traceId,
              taskId: task.id,
              userId,
              source: 'controller',
              type: 'ai.provider_diagnostic',
              payload: {
                snapshotId: promptBundle.snapshotId,
                usedFallback: completion.usedFallback,
                diagnostics: completion.diagnostics,
              },
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
              if (stateIsBlocked()) {
                blocked = true;
                break;
              }
              messages.push({
                role: 'tool',
                toolCallId: modelCall.id,
                name: modelCall.name,
                content: call.content,
              });
            }
            if (blocked) break;

            await emit('step_ended', { round, toolCalls: turn.toolCalls.length });
            toolDefinitions = filterAllowedTools(listAgentTools(), agentConfig);
            if (input.grants) {
              toolDefinitions = toolDefinitions.filter((definition) => allowedTool(definition.name));
            }
            if (webSearchDisabled) {
              toolDefinitions = toolDefinitions.filter(
                (definition) => definition.name !== WEB_SEARCH_TOOL_NAME
              );
            }
          }

          finalVerification =
            runtimeCalls.length === 0
              ? conversationalVerification()
              : combineVerifications(runtimeCalls.map((call) => call.verification));
          reply = aiText || fallbackReply(traces);
          if (!finalVerification.verified && runtimeCalls.length > 0) {
            reply = `I couldn’t verify every action. ${reply}`;
          }
        }
      } else if (intent.decision === 'SAFE_AUTO') {
        mode = 'system';
        finalVerification =
          runtimeCalls.length > 0
            ? combineVerifications(runtimeCalls.map((call) => call.verification))
            : conversationalVerification();
        reply =
          runtimeCalls.length === 1
            ? deterministicReply(runtimeCalls[0])
            : runtimeCalls.map(deterministicReply).join(' ');
      } else {
        mode = 'local';
        reply = 'I need an AI provider to answer that. Connect one in Settings.';
        finalVerification = verificationFailed('No local deterministic route or AI provider was available.');
      }

      if (!blocked && !stateIsBlocked()) {
        await transition('VERIFYING', 'running', { phase: 'verify' });
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    const cancelled = isCancellationError(error);
    const hadToolCalls = runtimeCalls.length > 0;

    if (hadToolCalls || stateIsBlocked()) {
      rethrow = cancelled ? new AgentTurnCancelledError(reason, task.id) : null;
      finalHybridState = cancelled && !hadToolCalls ? 'CANCELLED' : 'BLOCKED';
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
      finalHybridState = cancelled ? 'CANCELLED' : 'FAILED';
      finalVerification = cancelled
        ? verificationFailed(`Task ${task.id} was cancelled before verification.`, {
            interrupted: true,
            taskId: task.id,
          })
        : verificationFailed(reason);
      reply = cancelled ? `Stopped before completion. Task ${task.id} was cancelled.` : reason;
    }
  }

  if (!rethrow) {
    finalHybridState =
      stateIsBlocked()
        ? 'BLOCKED'
        : finalVerification.verified
          ? 'COMPLETED'
          : verificationToState(finalVerification);
  }

  finalStatus = toLegacyStatus(finalHybridState);
  await emit('turn_ended', {
    status: finalStatus,
    hybridState: finalHybridState,
    verified: finalVerification.verified,
    taskId: task.id,
    traceId: trace.traceId,
    toolCalls: runtimeCalls.length,
  });
  await hookEngine.executeHook('after_agent_turn', {
    userId,
    conversationId,
    timestamp: Date.now(),
    success: finalHybridState === 'COMPLETED',
    taskId: task.id,
  });

  await updateAgentTaskStatus(db, task.id, finalStatus, {
    phase: finalHybridState === 'COMPLETED' ? 'done' : 'verify',
    result: reply ? { reply, taskId: task.id } : null,
    verification: finalVerification,
    error: finalHybridState === 'COMPLETED' ? null : reply,
    finishedAt: Date.now(),
    leaseOwner: null,
    leaseUntil: null,
    hybridState: finalHybridState,
    traceId: trace.traceId,
  } as Parameters<typeof updateAgentTaskStatus>[3]);

  await recordHybridEvent(db, {
    traceId: trace.traceId,
    taskId: task.id,
    userId,
    source: 'controller',
    type: 'task.finished',
    payload: {
      hybridState: finalHybridState,
      status: finalStatus,
      verified: finalVerification.verified,
      toolCalls: runtimeCalls.length,
    },
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
    hybridState: finalHybridState,
    verification: finalVerification,
  };
}

// Keep the error type referenced so budget failures are intentionally typed in
// tests and callers without changing the public API.
export { BudgetExceededError };

// Re-exported for focused hybrid tests and callers that need the type guards.
export type { AutonomyDecision, HybridPlan, HybridTaskState };
