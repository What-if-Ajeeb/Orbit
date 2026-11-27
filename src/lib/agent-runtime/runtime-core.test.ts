import { describe, expect, it, vi } from 'vitest';

import { WEB_SEARCH_TOOL_NAME } from '../skills';
import { BudgetExceededError, BudgetTracker, resolveBudget } from './budgets';
import { routeDeterministically } from './capability-router';
import { hashChain, stableJson } from './hash';
import {
  combineVerifications,
  unverified,
  verificationFailed,
  verified,
  verifyToolCall,
} from './verification';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
vi.mock('../agent-settings', () => ({
  isToolAllowedForAgent: (
    config: { toolAccessMode?: string; allowedTools?: string[] } | undefined,
    toolName: string
  ) =>
    config?.toolAccessMode === 'selected'
      ? Array.isArray(config?.allowedTools) && config.allowedTools.includes(toolName)
      : true,
}));
vi.mock('../skills', () => ({ WEB_SEARCH_TOOL_NAME: 'skill_web_search_search_web' }));
vi.mock('../memory/tools', () => ({
  MEMORY_REMEMBER_TOOL_NAME: 'memory_remember',
  MEMORY_RECALL_TOOL_NAME: 'memory_recall',
  MEMORY_FORGET_TOOL_NAME: 'memory_forget',
}));
vi.mock('../plugins/demand', () => ({ inferDemandCapabilities: () => [] }));
vi.mock('../dates', () => ({
  parseTaskText: (text: string) => ({ title: text.trim(), hasTime: false, dueAt: null }),
}));
vi.mock('../ai/tool-registry', () => {
  const names = new Set([
    'list_tasks',
    'create_task',
    'complete_task',
    'memory_remember',
    'memory_recall',
    'memory_forget',
    'skill_web_search_search_web',
  ]);
  return {
    agentToolRegistry: {
      get: (name: string) => (names.has(name) ? { definition: { name } } : null),
      descriptors: () => [],
      register: () => undefined,
      execute: async () => ({ content: '{"ok":true}', success: true }),
    },
    toolFail: (message: string) => JSON.stringify({ ok: false, error: message }),
  };
});

describe('agent budgets', () => {
  it('clamps caller-supplied limits to safe bounds', () => {
    const budget = resolveBudget({
      maxToolCalls: -5,
      maxTokensIn: 1_000_000,
      maxWallMs: 1_000_000,
    });

    expect(budget.maxToolCalls).toBe(0);
    expect(budget.maxTokensIn).toBe(500_000);
    expect(budget.maxWallMs).toBe(1_000_000);
  });

  it('stops tool calls, tokens, retries, and nested agents at their caps', () => {
    const tracker = new BudgetTracker({
      ...resolveBudget({ maxToolCalls: 1, maxTokensIn: 1_000, maxTokensOut: 500, maxRetries: 0 }),
    });

    tracker.consumeToolCall();
    expect(() => tracker.consumeToolCall()).toThrow(BudgetExceededError);
    expect(() => tracker.consumeTokens(1_001, 0)).toThrow(BudgetExceededError);
    expect(() => tracker.consumeRetry()).toThrow(BudgetExceededError);
    expect(() => tracker.enterSubagent(2)).toThrow(BudgetExceededError);
  });
});

describe('verification', () => {
  const baseCall = {
    toolName: 'create_task',
    args: {},
    rawArguments: '{}',
    durationMs: 12,
    trace: '',
    verification: unverified('test fixture'),
  };

  it('accepts only a canonical success envelope', () => {
    expect(verifyToolCall({ ...baseCall, success: true, content: '{"ok":true}' }).status).toBe(
      'verified'
    );
    expect(
      verifyToolCall({ ...baseCall, success: true, content: '{"success":true}' }).status
    ).toBe('unverified');
    expect(verifyToolCall({ ...baseCall, success: true, content: '{"ok":false}' }).status).toBe(
      'failed'
    );
  });

  it('treats timeout and cancellation as uncertain rather than completed', () => {
    const timeout = verifyToolCall({
      ...baseCall,
      success: false,
      error: 'Tool timed out.',
      errorCode: 'TOOL_TIMEOUT',
      content: '',
    });
    const cancelled = verifyToolCall({
      ...baseCall,
      success: false,
      error: 'Tool cancelled.',
      errorCode: 'TOOL_CANCELLED',
      content: '',
    });

    expect(timeout.status).toBe('uncertain');
    expect(timeout.verified).toBe(false);
    expect(cancelled.status).toBe('uncertain');
  });

  it('never lets one good call hide a weaker result', () => {
    const combined = combineVerifications([
      verified('one ok'),
      unverified('no envelope'),
      verificationFailed('denied'),
    ]);

    expect(combined.status).toBe('failed');
    expect(combined.verified).toBe(false);
  });
});

describe('durable hashing', () => {
  it('is stable across object key order and changes with content', () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
    expect(hashChain({ a: 1 })).toBe(hashChain({ a: 1 }));
    expect(hashChain({ a: 1 })).not.toBe(hashChain({ a: 2 }));
  });
});

describe('deterministic capability router', () => {
  const config = {
    userId: 1,
    agentId: 'master',
    instructions: '',
    memory: '',
    toolAccessMode: 'all' as const,
    allowedTools: [],
    createdAt: 0,
    updatedAt: 0,
  };

  it('routes unambiguous memory requests to the registered tool', () => {
    const route = routeDeterministically({
      text: 'Remember that the backup code is in the safe.',
      agentConfig: config,
    });

    expect(route.kind).toBe('handled');
    if (route.kind === 'handled') {
      expect(route.calls[0]?.toolName).toBe('memory_remember');
    }
  });

  it('routes web search as untrusted data, not an instruction source', () => {
    const route = routeDeterministically({
      text: 'search the web for Expo SDK 58 background tasks',
      agentConfig: config,
    });

    expect(route.kind).toBe('partial');
    if (route.kind === 'partial') {
      expect(route.calls[0]?.toolName).toBe(WEB_SEARCH_TOOL_NAME);
      expect(route.notes.join(' ')).toMatch(/external data/i);
    }
  });

  it('denies a handled action when the agent is not allowed to use its tool', () => {
    const route = routeDeterministically({
      text: 'list my tasks',
      agentConfig: { ...config, allowedTools: [], toolAccessMode: 'selected' },
    });

    expect(route.kind).toBe('denied');
  });

  it('sends ambiguous requests to AI with no claimed completion', () => {
    const route = routeDeterministically({ text: 'Maybe think about something.', agentConfig: config });
    expect(route.kind).toBe('needs_ai');
  });
});
