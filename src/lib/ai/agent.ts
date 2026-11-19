import type { SQLiteDatabase } from 'expo-sqlite';

import { runLocalAgent } from './local-agent';
import { buildSystemPrompt } from './prompt';
import { requestCompletion } from './providers';
import { isAiConfigured, type AiSettings } from './settings';
import { AGENT_TOOLS, executeTool } from './tools';
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

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const { db, userId, userName, history, settings } = input;

  if (!isAiConfigured(settings)) {
    const local = await runLocalAgent(db, userId, history[history.length - 1]?.content ?? '');
    return { ...local, mode: 'local' };
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(userName) },
    ...history
      .filter((item) => item.content.trim().length > 0)
      .slice(-20)
      .map((item) => ({ role: item.role, content: item.content }) as LlmMessage),
  ];

  const traces: string[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const turn = await requestCompletion(settings, messages, AGENT_TOOLS);

      if (turn.toolCalls.length === 0) {
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
        let content: string;
        let trace = '';

        try {
          const execution = await executeTool(db, userId, call.name, call.arguments);
          content = execution.content;
          trace = execution.trace;
        } catch (toolError) {
          content = JSON.stringify({
            ok: false,
            error: toolError instanceof Error ? toolError.message : 'Tool execution failed.',
          });
        }

        if (trace) {
          traces.push(trace);
        }

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content,
        });
      }
    }

    return { reply: fallbackReply(traces), traces, mode: 'ai' };
  } catch (error) {
    if (traces.length > 0) {
      const reason = error instanceof Error ? error.message : 'Unknown error';

      return {
        reply: `Changes save ho gaye, lekin AI reply nahi de paya. (${reason})`,
        traces,
        mode: 'ai',
      };
    }

    throw error;
  }
}
