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
import type { ToolExecutionEvent } from '../chat-store';
import { ensureMcpTools } from '../mcp/registry';
import { EventStore } from '../events';
import { TelemetryStore } from '../telemetry';
import { policyEngine } from '../policy';
import { buildCordisTools } from '../cordis-tools';
import { HookEngine } from '../hooks';
import { SkillStore, SkillExecutor } from '../skills';
import { MASTER_AGENT } from '../permissions/agents';
import { secureExecuteTool } from '../permissions/executor';
import { redactSecrets } from '../permissions/redact';
import type { AgentIdentity } from '../permissions/types';
import { getActiveBuddy } from '../buddy/store';
import { runLocalAgent } from './local-agent';
import { buildSystemPrompt } from './prompt';
import { requestCompletion } from './providers';
import { isAiConfigured, type AiSettings } from './settings';
import { executeTool, listAgentTools, agentToolRegistry } from './tools';
import { parseArtifactToolRef } from './artifact-tools';
import { toolFail } from './tool-registry';
import type { ArtifactRef } from '../artifacts/types';
import type { LlmAttachment, LlmMessage } from './types';

export type AgentHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: LlmAttachment[];
};

export type AgentInput = {
  db: SQLiteDatabase;
  userId: number;
  userName: string;
  history: AgentHistoryItem[];
  settings: AiSettings;
  conversationId: number;
  /** The agent identity that owns every permission request made this turn. */
  agent?: AgentIdentity;
  /** Permission scope: the agent + project + tool + category are all required. */
  projectId?: string;
  projectLabel?: string;
  /**
   * Creator mode: enables cordis_* self-extension tools so the agent can
   * write, install, and mount new plugins or UI overlays live.
   */
  creatorMode?: boolean;
  /** Receives streamed text from providers that support token streaming. */
  onTextDelta?: (delta: string) => void;
  /** Receives live tool status so the chat UI can show execution progress. */
  onToolEvent?: (event: ToolExecutionEvent) => void;
  /** Aborts the in-flight completion when the user stops or leaves the screen. */
  signal?: AbortSignal;
};

export type AgentResult = {
  reply: string;
  traces: string[];
  /** Artifacts created or updated during this turn, for the chat message meta. */
  artifacts: ArtifactRef[];
  toolEvents: ToolExecutionEvent[];
  mode: 'ai' | 'local';
};

const MAX_TOOL_ROUNDS = 6;

function fallbackReply(traces: string[]): string {
  if (traces.length === 0) {
    return 'Ho gaya. Aur kuch chahiye?';
  }

  return `Done — ${traces.join(' · ')}`;
}

const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));

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

type PluginActivation = {
  action: string;
  pluginId: string;
  toolNames: string[];
};

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

/**
 * A successful install includes an explicit plugin approval. In selected-mode
 * agents, grant only the exact tools that the approved plugin registered; do
 * not broaden access by wildcard or touch unrelated agent settings.
 */
async function grantApprovedPluginTools(
  db: SQLiteDatabase,
  config: AgentConfig,
  activation: PluginActivation
): Promise<AgentConfig> {
  if (config.toolAccessMode === 'all' || activation.toolNames.length === 0) {
    return config;
  }

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

  if (approved.length === 0) {
    return config;
  }

  const next = Array.from(new Set([...config.allowedTools, ...approved])).sort((a, b) =>
    a.localeCompare(b)
  );

  if (next.length === config.allowedTools.length) {
    return config;
  }

  return saveAgentConfig(db, config.userId, config.agentId, { allowedTools: next });
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const {
    db,
    userId,
    userName,
    history,
    settings,
    conversationId,
    agent: requestedAgent,
    projectId,
    projectLabel,
    creatorMode,
    onTextDelta,
    onToolEvent,
    signal,
  } = input;

  const agent = requestedAgent ?? MASTER_AGENT;
  const activeProjectId = projectId ?? 'orbit-workspace';
  const activeProjectLabel = projectLabel ?? 'Orbit workspace';

  let agentConfig: AgentConfig = defaultAgentConfig(userId, agent.id);

  try {
    agentConfig = await loadAgentConfig(db, userId, agent.id);
  } catch (error) {
    console.warn('Could not load agent configuration; using safe defaults.', error);
  }

  const eventStore = new EventStore(db);
  const telemetry = new TelemetryStore(db);
  const hookEngine = new HookEngine(db);
  const skillStore = new SkillStore(db);
  const skillExecutor = new SkillExecutor(skillStore);

  const emit = async (
    type:
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
      | 'paused',
    payload: Record<string, unknown>
  ) => {
    await eventStore.appendEvent(userId, conversationId, type, payload);
  };

  if (!isAiConfigured(settings)) {
    const local = await runLocalAgent(db, userId, history[history.length - 1]?.content ?? '');
    await emit('turn_started', { mode: 'local', input: history[history.length - 1]?.content ?? '' });
    await emit('turn_ended', { mode: 'local', reply: local.reply });
    return { ...local, artifacts: [], toolEvents: [], mode: 'local' };
  }

  // Phase 4: load active buddy so the system prompt can include personality + state
  let buddyCtx: { buddy: NonNullable<Awaited<ReturnType<typeof getActiveBuddy>>> } | undefined;
  try {
    const activeBuddy = await getActiveBuddy(db, userId);
    if (activeBuddy) {
      buddyCtx = { buddy: activeBuddy };
    }
  } catch (err) {
    console.warn('Could not load active buddy for prompt', err);
  }

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(userName, agent.name, Date.now(), buddyCtx, {
        instructions: agentConfig.instructions,
        memory: agentConfig.memory,
      }),
    },
    ...history
      .filter((item) => item.content.trim().length > 0 || (item.attachments?.length ?? 0) > 0)
      .slice(-20)
      .map((item) =>
        (item.role === 'user'
          ? {
              role: 'user',
              content: item.content,
              ...(item.attachments && item.attachments.length > 0
                ? { attachments: item.attachments }
                : {}),
            }
          : { role: 'assistant', content: item.content }) as LlmMessage
      ),
  ];

  // Refresh MCP tools at most every five minutes; a failing server cannot
  // block the chat because ensureMcpTools never throws.
  await ensureMcpTools();

  // Load skills and register skill tools as agent tools
  const registeredSkills = await skillStore.listSkills();
  for (const skill of registeredSkills) {
    if (!skill.enabled) continue;
    for (const cap of skill.capabilities) {
      agentToolRegistry.register(
        {
          definition: {
            name: `${skill.id}_${cap.name}`,
            description: cap.description,
            parameters: cap.inputSchema,
          },
          execute: async (_ctx, args) => {
            const result = await skillExecutor.execute(skill.id, cap.name, args);
            return {
              content: JSON.stringify(result),
              trace: `Skill ${skill.name} → ${cap.name}`,
            };
          },
        },
        { replace: true }
      );
    }
  }

  // Run before_agent_turn hooks
  await hookEngine.executeHook('before_agent_turn', {
    userId,
    conversationId,
    timestamp: Date.now(),
  });

  if (creatorMode) {
    const cordisTools = buildCordisTools(db);
    for (const tool of cordisTools) {
      agentToolRegistry.register(tool, { replace: true });
    }
    await emit('turn_started', {
      creatorMode: true,
      cordisTools: cordisTools.map((t) => t.definition.name),
    });
  }

  let toolDefinitions = filterAllowedTools(listAgentTools(), agentConfig);
  const traces: string[] = [];
  const toolEvents: ToolExecutionEvent[] = [];
  const artifactRefs = new Map<string, ArtifactRef>();

  await emit('turn_started', {
    model: settings.model,
    provider: settings.provider,
    agentId: agent.id,
    agentName: agent.name,
    projectId: activeProjectId,
    hasBuddy: !!buddyCtx,
  });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (signal?.aborted) {
        throw new Error('AI request cancelled.');
      }

      await emit('step_started', { round });

      const requestTokens = messages.reduce(
        (sum, m) => sum + estimateTokens(m.content),
        0
      );
      await emit('ai_request', { tokensIn: requestTokens, messageCount: messages.length });

      const turn = await requestCompletion(settings, messages, toolDefinitions, {
        onTextDelta,
        signal,
      });

      await emit('ai_response', { tokensOut: estimateTokens(turn.text ?? ''), replyLength: turn.text?.length ?? 0 });

      if (turn.toolCalls.length === 0) {
        await emit('step_ended', { round, toolCalls: 0 });
        await emit('turn_ended', { round, toolCalls: 0 });
        await hookEngine.executeHook('after_agent_turn', {
          userId,
          conversationId,
          timestamp: Date.now(),
          success: true,
        });
        return {
          reply: turn.text || fallbackReply(traces),
          traces,
          artifacts: Array.from(artifactRefs.values()),
          toolEvents,
          mode: 'ai',
        };
      }

      messages.push({
        role: 'assistant',
        content: turn.text,
        toolCalls: turn.toolCalls,
      });

      for (const call of turn.toolCalls) {
        const toolArgs = parseToolArguments(call.arguments);

        if (!isToolAllowedForAgent(agentConfig, call.name)) {
          const denied: ToolExecutionEvent = {
            id: newToolEventId(),
            toolName: call.name,
            status: 'denied',
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 0,
            summary: `${call.name} is not enabled for ${agent.name}.`,
            detail: 'Agent tool access is restricted. Enable it in this agent’s tool settings.',
          };
          toolEvents.push(denied);
          onToolEvent?.(denied);

          await emit('tool_call', {
            toolName: call.name,
            agentId: agent.id,
            agentName: agent.name,
            rawArguments: redactSecrets(call.arguments).slice(0, 2000),
            unauthorized: true,
          });
          await emit('tool_result', {
            toolName: call.name,
            success: false,
            denied: true,
            reason: 'Agent tool access is restricted.',
          });
          await telemetry.recordToolCall(
            userId,
            conversationId,
            call.name,
            0,
            null,
            null,
            null,
            false,
            'deny',
            'Agent tool access is restricted.'
          );
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: toolFail(`${call.name} is not enabled for this agent.`),
          });
          continue;
        }

        await emit('tool_call', {
          toolName: call.name,
          agentId: agent.id,
          agentName: agent.name,
          rawArguments: redactSecrets(call.arguments).slice(0, 2000),
        });

        const running: ToolExecutionEvent = {
          id: newToolEventId(),
          toolName: call.name,
          status: 'running',
          startedAt: Date.now(),
          summary: `Running ${call.name}`,
        };
        toolEvents.push(running);
        onToolEvent?.(running);

        const policy = policyEngine.evaluate(call.name, toolArgs);
        running.policyDecision = policy.decision;
        onToolEvent?.(running);
        const registeredTool = agentToolRegistry.get(call.name);
        const secured = await secureExecuteTool({
          db,
          userId,
          agent,
          conversationId,
          projectId: activeProjectId,
          projectLabel: activeProjectLabel,
          toolName: call.name,
          rawArguments: call.arguments,
          policy: {
            decision: policy.decision,
            ruleId: policy.ruleId,
            reason: policy.reason,
          },
          timeoutMs: registeredTool?.timeoutMs,
          signal,
          execute: (toolSignal) =>
            executeTool(
              db,
              userId,
              call.name,
              call.arguments,
              conversationId,
              toolSignal,
              agent
            ),
        });
        const content = secured.content;
        const trace = secured.trace;
        const success = secured.success;
        const error = secured.error;
        const denied = !secured.permission.allowed;

        if (success && call.name === 'orbit_plugin_request') {
          const activation = parsePluginActivation(content);

          if (activation && activation.action !== 'reused') {
            agentConfig = await grantApprovedPluginTools(db, agentConfig, activation);
            toolDefinitions = filterAllowedTools(listAgentTools(), agentConfig);
          }
        }
        const status: ToolExecutionEvent['status'] = denied ? 'denied' : success ? 'success' : 'error';
        const finished: ToolExecutionEvent = {
          ...running,
          status,
          endedAt: Date.now(),
          durationMs: secured.durationMs,
          summary: denied
            ? `${call.name} was not approved.`
            : success
              ? `${call.name} completed.`
              : `${call.name} failed.`,
          ...(error || trace ? { detail: redactSecrets(error || trace).slice(0, 800) } : {}),
        };
        const index = toolEvents.indexOf(running);

        if (index >= 0) {
          toolEvents[index] = finished;
        }

        onToolEvent?.(finished);

        if (trace) {
          traces.push(trace);
        }

        if (success && call.name.startsWith('artifact_')) {
          const ref = parseArtifactToolRef(content);

          if (ref) {
            // Latest version wins when the same artifact changes twice a turn.
            artifactRefs.set(ref.id, ref);
          }
        }

        await telemetry.recordToolCall(
          userId,
          conversationId,
          call.name,
          secured.durationMs,
          null,
          null,
          null,
          success,
          policy.decision,
          secured.errorCode ? `${secured.errorCode}: ${error ?? ''}` : error
        );
        await emit('tool_result', {
          toolName: call.name,
          durationMs: secured.durationMs,
          success,
          error,
          resultLength: content.length,
          policy: policy.decision,
          rule: policy.ruleName,
          permission: secured.permission,
        });

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content,
        });
      }

      await emit('step_ended', { round, toolCalls: turn.toolCalls.length });
    }

    await emit('turn_ended', { rounds: MAX_TOOL_ROUNDS, toolCalls: traces.length });
    await hookEngine.executeHook('after_agent_turn', {
      userId,
      conversationId,
      timestamp: Date.now(),
      success: true,
      rounds: MAX_TOOL_ROUNDS,
      toolCalls: traces.length,
    });
    return {
      reply: fallbackReply(traces),
      traces,
      artifacts: Array.from(artifactRefs.values()),
      toolEvents,
      mode: 'ai',
    };
  } catch (error) {
    if (traces.length > 0) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      await emit('turn_ended', { error: reason, partial: true });
      await hookEngine.executeHook('after_agent_turn', {
        userId,
        conversationId,
        timestamp: Date.now(),
        success: false,
        error: reason,
      });
      return {
        reply: `Your changes were saved, but the AI could not reply. (${reason})`,
        traces,
        artifacts: Array.from(artifactRefs.values()),
        toolEvents,
        mode: 'ai',
      };
    }

    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    await emit('turn_ended', { error: errMsg, failed: true });
    await hookEngine.executeHook('after_agent_turn', {
      userId,
      conversationId,
      timestamp: Date.now(),
      success: false,
      error: errMsg,
      failed: true,
    });
    await hookEngine.executeHook('on_error', {
      userId,
      conversationId,
      timestamp: Date.now(),
      error: errMsg,
    });
    throw error;
  }
}
