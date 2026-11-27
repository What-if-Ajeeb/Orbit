import type { SQLiteDatabase } from 'expo-sqlite';

import { agentToolRegistry } from './tool-registry';
import type { AgentToolDescriptor, ToolExecution } from './tool-registry';
import { TASK_TOOLS } from './task-tools';
import { ARTIFACT_TOOLS } from './artifact-tools';
import { FILE_SAFETY_TOOLS } from './file-safety-tools';
import type { LlmToolDefinition } from './types';
import type { AgentIdentity } from '../permissions/types';
import { COMPUTER_EXECUTE_TOOL } from '../permissions/computer-tool';
import { AGENT_ACTION_PROPOSE_TOOL } from './agent-action-tools';
import { MEMORY_TOOLS } from '../memory/tools';
import '../connections/tools';
import { buildDemandTools } from '../plugins/demand-tools';

// Built-in tool plugins. Orbit can add another capability by registering a new
// AgentTool here (or from an add-on module) without editing the agent loop.
for (const tool of [
  ...TASK_TOOLS,
  ...ARTIFACT_TOOLS,
  ...FILE_SAFETY_TOOLS,
  COMPUTER_EXECUTE_TOOL,
  AGENT_ACTION_PROPOSE_TOOL,
  ...MEMORY_TOOLS,
  ...buildDemandTools(),
]) {
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
  signal?: AbortSignal,
  agent?: AgentIdentity
): Promise<ToolExecution> {
  return agentToolRegistry.execute(
    { db, userId, conversationId, signal, agent },
    name,
    rawArguments
  );
}

export { agentToolRegistry };
export type {
  AgentTool,
  AgentToolContext,
  AgentToolDescriptor,
  AgentToolProvenance,
  ToolExecution,
} from './tool-registry';
