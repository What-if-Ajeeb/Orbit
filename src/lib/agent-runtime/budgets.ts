import type { AgentBudget } from './types';

export const DEFAULT_BUDGET: Required<AgentBudget> = {
  maxWallMs: 5 * 60 * 1000,
  maxToolCalls: 20,
  maxTokensIn: 60_000,
  maxTokensOut: 12_000,
  maxRetries: 2,
  maxSubagentDepth: 1,
  maxCostUnits: 100,
};

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export function resolveBudget(input?: AgentBudget): Required<AgentBudget> {
  if (!input) return { ...DEFAULT_BUDGET };

  const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.floor(value)))
      : fallback;

  return {
    maxWallMs: clamp(input.maxWallMs, DEFAULT_BUDGET.maxWallMs, 1_000, 60 * 60 * 1000),
    maxToolCalls: clamp(input.maxToolCalls, DEFAULT_BUDGET.maxToolCalls, 0, 200),
    maxTokensIn: clamp(input.maxTokensIn, DEFAULT_BUDGET.maxTokensIn, 1_000, 500_000),
    maxTokensOut: clamp(input.maxTokensOut, DEFAULT_BUDGET.maxTokensOut, 500, 100_000),
    maxRetries: clamp(input.maxRetries, DEFAULT_BUDGET.maxRetries, 0, 6),
    maxSubagentDepth: clamp(input.maxSubagentDepth, DEFAULT_BUDGET.maxSubagentDepth, 0, 3),
    maxCostUnits: clamp(input.maxCostUnits, DEFAULT_BUDGET.maxCostUnits, 0, 10_000),
  };
}

export type BudgetUsage = {
  startedAt: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  retries: number;
  subagentDepth: number;
  costUnits: number;
};

/** Runtime counters for one agent task. All limits are host-side and cooperative. */
export class BudgetTracker {
  readonly limits: Required<AgentBudget>;
  readonly usage: BudgetUsage;

  constructor(limits: Required<AgentBudget>, now: number = Date.now()) {
    this.limits = limits;
    this.usage = {
      startedAt: now,
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
      retries: 0,
      subagentDepth: 0,
      costUnits: 0,
    };
  }

  assertActive(now: number = Date.now()): void {
    if (now - this.usage.startedAt >= this.limits.maxWallMs) {
      throw new BudgetExceededError('The task exceeded its wall-clock budget.');
    }
  }

  consumeToolCall(now: number = Date.now()): void {
    this.assertActive(now);
    this.usage.toolCalls += 1;
    if (this.usage.toolCalls > this.limits.maxToolCalls) {
      throw new BudgetExceededError('The task exceeded its tool-call budget.');
    }
  }

  consumeTokens(tokensIn: number, tokensOut: number, now: number = Date.now()): void {
    this.assertActive(now);
    this.usage.tokensIn += Math.max(0, Math.ceil(tokensIn));
    this.usage.tokensOut += Math.max(0, Math.ceil(tokensOut));
    if (this.usage.tokensIn > this.limits.maxTokensIn) {
      throw new BudgetExceededError('The task exceeded its input-token budget.');
    }
    if (this.usage.tokensOut > this.limits.maxTokensOut) {
      throw new BudgetExceededError('The task exceeded its output-token budget.');
    }
  }

  consumeRetry(now: number = Date.now()): void {
    this.assertActive(now);
    this.usage.retries += 1;
    if (this.usage.retries > this.limits.maxRetries) {
      throw new BudgetExceededError('The task exceeded its retry budget.');
    }
  }

  enterSubagent(depth: number, now: number = Date.now()): void {
    this.assertActive(now);
    if (depth > this.limits.maxSubagentDepth) {
      throw new BudgetExceededError('The task exceeded its subagent depth budget.');
    }
    this.usage.subagentDepth = Math.max(this.usage.subagentDepth, depth);
  }

  consumeCost(units: number, now: number = Date.now()): void {
    this.assertActive(now);
    this.usage.costUnits += Math.max(0, units);
    if (this.usage.costUnits > this.limits.maxCostUnits) {
      throw new BudgetExceededError('The task exceeded its cost budget.');
    }
  }

  snapshot(): Record<string, number> {
    return {
      elapsedMs: Date.now() - this.usage.startedAt,
      ...this.usage,
    };
  }
}
