import { runAgentTurn } from '../agent-runtime/orchestrator';
import type { RuntimeHistoryItem, RuntimeTurnInput, RuntimeTurnResult } from '../agent-runtime/types';

/**
 * Backwards-compatible chat entry point. The real System-first orchestration
 * lives in `agent-runtime/orchestrator.ts`; this module preserves the public
 * API used by chat, workflows, and tests.
 */
export type AgentHistoryItem = RuntimeHistoryItem;
export type AgentInput = RuntimeTurnInput;
export type AgentResult = RuntimeTurnResult;

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  return runAgentTurn(input);
}
