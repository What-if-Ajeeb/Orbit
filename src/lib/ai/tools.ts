import type { SQLiteDatabase } from 'expo-sqlite';

import { agentToolRegistry } from './tool-registry';
import type { AgentToolDescriptor, ToolExecution } from './tool-registry';
import { TASK_TOOLS } from './task-tools';
import { ARTIFACT_TOOLS } from './artifact-tools';
import type { LlmToolDefinition } from './types';
import { COMPUTER_EXECUTE_TOOL } from '../permissions/computer-tool';
import '../connections/tools';

// Built-in tool plugins. Orbit can add another capability by registering a new
// AgentTool here (or from an add-on module) without editing the agent loop.
for (const tool of [...TASK_TOOLS, ...ARTIFACT_TOOLS, COMPUTER_EXECUTE_TOOL]) {
  if (!agentToolRegistry.get(tool.definition.name)) {
    agentToolRegistry.register(tool);
  }
}

export function listAgentTools(): LlmToolDefinition[] {
  return agentToolRegistry.definitions();
}

export function listAgentToolDescriptors(): AgentToolDescriptor[] {
  return agentToolRegistry.descriptors();
}

export async function executeTool(
  db: SQLiteDatabase,
  userId: number,
  name: string,
  rawArguments: string,
  conversationId?: number,
  signal?: AbortSignal
): Promise<ToolExecution> {
  return agentToolRegistry.execute({ db, userId, conversationId, signal }, name, rawArguments);
}

export { agentToolRegistry };
export type {
  AgentTool,
  AgentToolContext,
  AgentToolDescriptor,
  AgentToolProvenance,
  ToolExecution,
} from './tool-registry';
