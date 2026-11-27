/**
 * Backward-compatible entry point for the Agent v1 runtime.
 *
 * The implementation now lives in the central Hybrid Agent controller. This
 * wrapper keeps existing imports stable while the canonical state machine,
 * planner, approvals and verification are owned in one place.
 */
export {
  AgentTurnCancelledError,
  BudgetExceededError,
  runAgentTurn,
} from '../hybrid-agent/controller';
