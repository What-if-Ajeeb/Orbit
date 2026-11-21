import type { SQLiteDatabase } from 'expo-sqlite';

import { agentToolRegistry } from './tool-registry';
import type { ToolExecution } from './tool-registry';
import { TASK_TOOLS } from './task-tools';
import type { LlmToolDefinition } from './types';
import { COMPUTER_EXECUTE_TOOL } from '../permissions/computer-tool';

// Built-in tool plugins. Orbit can add another capability by registering a new
// AgentTool here (or from an add-on module) without editing the agent loop.
for (const tool of [...TASK_TOOLS, COMPUTER_EXECUTE_TOOL]) {
  if (!agentToolRegistry.get(tool.definition.name)) {
    agentToolRegistry.register(tool);
  }
}

export function listAgentTools(): LlmToolDefinition[] {
  return agentToolRegistry.definitions();
}

export async function executeTool(
  db: SQLiteDatabase,
  userId: number,
  name: string,
  rawArguments: string
): Promise<ToolExecution> {
  return agentToolRegistry.execute({ db, userId }, name, rawArguments);
}

export { agentToolRegistry };
export type { AgentTool, AgentToolContext, ToolExecution } from './tool-registry';
