import type { SQLiteDatabase } from 'expo-sqlite';

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
import type { LlmMessage } from './types';

export type AgentHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
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
};

export type AgentResult = {
  reply: string;
  traces: string[];
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
  } = input;

  const agent = requestedAgent ?? MASTER_AGENT;
  const activeProjectId = projectId ?? 'orbit-workspace';
  const activeProjectLabel = projectLabel ?? 'Orbit workspace';

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
    return { ...local, mode: 'local' };
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
    { role: 'system', content: buildSystemPrompt(userName, agent.name, Date.now(), buddyCtx) },
    ...history
      .filter((item) => item.content.trim().length > 0)
      .slice(-20)
      .map((item) => ({ role: item.role, content: item.content }) as LlmMessage),
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

  const toolDefinitions = listAgentTools();
  const traces: string[] = [];

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
      await emit('step_started', { round });

      const requestTokens = messages.reduce(
        (sum, m) => sum + estimateTokens(m.content),
        0
      );
      await emit('ai_request', { tokensIn: requestTokens, messageCount: messages.length });

      const turn = await requestCompletion(settings, messages, toolDefinitions);

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

        await emit('tool_call', {
          toolName: call.name,
          agentId: agent.id,
          agentName: agent.name,
          rawArguments: redactSecrets(call.arguments).slice(0, 2000),
        });

        const policy = policyEngine.evaluate(call.name, toolArgs);
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
          execute: () => executeTool(db, userId, call.name, call.arguments),
        });
        const content = secured.content;
        const trace = secured.trace;
        const success = secured.success;
        const error = secured.error;

        if (trace) {
          traces.push(trace);
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
          error
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
    return { reply: fallbackReply(traces), traces, mode: 'ai' };
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
        reply: `Changes save ho gaye, lekin AI reply nahi de paya. (${reason})`,
        traces,
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
