import type { SQLiteDatabase } from 'expo-sqlite';

import type { LlmToolDefinition } from './types';
import type { AgentIdentity } from '../permissions/types';

export type ToolExecution = {
  content: string;
  /** Short human-readable description for the chat transcript. Empty = no chip. */
  trace: string;
};

export type AgentToolContext = {
  db: SQLiteDatabase;
  userId: number;
  /** Conversation the tool call belongs to, when the caller knows it. */
  conversationId?: number;
  /** Cancels long-running tool work when the user stops the turn. */
  signal?: AbortSignal;
  /** Identity of the agent whose turn is running. Never passed to plugin code. */
  agent?: AgentIdentity;
};

export type AgentToolProvenance = {
  source: 'builtin' | 'plugin' | 'mcp' | 'connection';
  pluginId?: string;
  trustLevel?: string;
  permissions?: string[];
};

/**
 * A tool plugin owns its model-facing schema and its implementation. The agent
 * only sees the registry, so tools can be added or replaced without touching
 * the loop.
 */
export type AgentTool = {
  definition: LlmToolDefinition;
  /** Where the tool came from. Used by the harness and diagnostics. */
  meta?: AgentToolProvenance;
  /**
   * Cooperative execution limit in milliseconds. It is host metadata and is
   * never sent to the model; the permission executor owns the timer.
   */
  timeoutMs?: number;
  execute: (
    context: AgentToolContext,
    args: Record<string, unknown>
  ) => Promise<ToolExecution>;
};

export type AgentToolDescriptor = {
  definition: LlmToolDefinition;
  meta?: AgentToolProvenance;
};

type RegisterOptions = {
  /** Replace a tool with the same name instead of throwing. */
  replace?: boolean;
};

export function toolOk(content: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...content });
}

export function toolFail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

function parseArguments(rawArguments: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown;

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class AgentToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool, options: RegisterOptions = {}): void {
    const name = tool.definition.name.trim();

    if (!name) {
      throw new Error('A tool plugin needs a non-empty definition.name.');
    }

    if (!options.replace && this.tools.has(name)) {
      throw new Error(`Agent tool "${name}" is already registered.`);
    }

    this.tools.set(name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): AgentTool | null {
    return this.tools.get(name) ?? null;
  }

  definitions(): LlmToolDefinition[] {
    return Array.from(this.tools.values(), (tool) => tool.definition);
  }

  descriptors(): AgentToolDescriptor[] {
    return Array.from(this.tools.values(), (tool) => ({
      definition: tool.definition,
      meta: tool.meta,
    }));
  }

  async execute(
    context: AgentToolContext,
    name: string,
    rawArguments: string
  ): Promise<ToolExecution> {
    const tool = this.tools.get(name);

    if (!tool) {
      return { content: toolFail(`Unknown tool: ${name}`), trace: '' };
    }

    const args = parseArguments(rawArguments);

    if (!args) {
      return { content: toolFail('Arguments must be a JSON object.'), trace: '' };
    }

    return tool.execute(context, args);
  }
}

export const agentToolRegistry = new AgentToolRegistry();
