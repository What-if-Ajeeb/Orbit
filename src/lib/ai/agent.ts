import type { SQLiteDatabase } from 'expo-sqlite';

import { ensureMcpTools } from '../mcp/registry';
import { EventStore } from '../events';
import { TelemetryStore } from '../telemetry';
import { policyEngine } from '../policy';
import { runLocalAgent } from './local-agent';
import { buildSystemPrompt } from './prompt';
import { requestCompletion } from './providers';
import { isAiConfigured, type AiSettings } from './settings';
import { executeTool, listAgentTools } from './tools';
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
  /**
   * Asks the user whether a tool call that requires approval may run.
   * Return false to block the call; return true to execute it.
   */
  onToolApproval?: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<boolean>;
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

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const {
    db,
    userId,
    userName,
    history,
    settings,
    conversationId,
    onToolApproval,
  } = input;

  const eventStore = new EventStore(db);
  const telemetry = new TelemetryStore(db);

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

  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(userName) },
    ...history
      .filter((item) => item.content.trim().length > 0)
      .slice(-20)
      .map((item) => ({ role: item.role, content: item.content }) as LlmMessage),
  ];

  // Refresh MCP tools at most every five minutes; a failing server cannot
  // block the chat because ensureMcpTools never throws.
  await ensureMcpTools();

  const toolDefinitions = listAgentTools();
  const traces: string[] = [];

  await emit('turn_started', { model: settings.model, provider: settings.provider });

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
        await emit('tool_call', { toolName: call.name, rawArguments: call.arguments });

        const policy = policyEngine.evaluate(
          call.name,
          JSON.parse(call.arguments || '{}')
        );
        let content: string;
        let trace = '';
        let success = true;
        let error: string | undefined;

        if (policy.decision === 'deny') {
          success = false;
          error = `Blocked by policy: ${policy.reason ?? policy.ruleName ?? 'policy'}`;
          content = JSON.stringify({ ok: false, error });
          trace = `BLOCKED ${call.name}`;
          await telemetry.recordToolCall(
            userId,
            conversationId,
            call.name,
            0,
            null,
            null,
            null,
            false,
            policy.decision,
            error
          );
          await emit('tool_result', {
            toolName: call.name,
            durationMs: 0,
            success: false,
            error,
            resultLength: content.length,
            policy: policy.decision,
            rule: policy.ruleName,
          });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content,
          });
          continue;
        }

        if (policy.decision === 'ask') {
          const approved = await onToolApproval?.(call.name, JSON.parse(call.arguments || '{}'));
          if (!approved) {
            success = false;
            error = 'User denied tool execution';
            content = JSON.stringify({ ok: false, error });
            trace = `DENIED ${call.name}`;
            await telemetry.recordToolCall(
              userId,
              conversationId,
              call.name,
              0,
              null,
              null,
              null,
              false,
              policy.decision,
              error
            );
            await emit('tool_result', {
              toolName: call.name,
              durationMs: 0,
              success: false,
              error,
              resultLength: content.length,
              policy: policy.decision,
              rule: policy.ruleName,
            });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content,
            });
            continue;
          }
        }

        const start = Date.now();
        try {
          const execution = await executeTool(db, userId, call.name, call.arguments);
          content = execution.content;
          trace = execution.trace;
        } catch (toolError) {
          success = false;
          error = toolError instanceof Error ? toolError.message : 'Tool execution failed.';
          content = JSON.stringify({
            ok: false,
            error,
          });
        }

        const durationMs = Date.now() - start;

        if (trace) {
          traces.push(trace);
        }

        await telemetry.recordToolCall(
          userId,
          conversationId,
          call.name,
          durationMs,
          null,
          null,
          null,
          success,
          policy.decision,
          error
        );
        await emit('tool_result', {
          toolName: call.name,
          durationMs,
          success,
          error,
          resultLength: content.length,
          policy: policy.decision,
          rule: policy.ruleName,
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
    return { reply: fallbackReply(traces), traces, mode: 'ai' };
  } catch (error) {
    if (traces.length > 0) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      await emit('turn_ended', { error: reason, partial: true });
      return {
        reply: `Changes save ho gaye, lekin AI reply nahi de paya. (${reason})`,
        traces,
        mode: 'ai',
      };
    }

    await emit('turn_ended', { error: error instanceof Error ? error.message : 'Unknown error', failed: true });
    throw error;
  }
}
