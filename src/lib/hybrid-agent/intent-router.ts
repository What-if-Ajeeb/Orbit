import type { AgentConfig } from '../agent-settings';
import { routeDeterministically } from '../agent-runtime/capability-router';

import { isProhibitedCapability } from './capability-catalog';
import type { HybridIntent, HybridIntentKind } from './types';

const PROHIBITED_PATTERNS: RegExp[] = [
  /\b(?:ignore|forget|override)\s+(?:all\s+)?(?:previous|prior|system)\s+instructions\b/i,
  /\b(?:grant|approve|disable|bypass)\b.{0,40}\b(?:permission|sandbox|approval|policy)\b/i,
  /\b(?:run|execute)\b.{0,30}\b(?:shell|bash|powershell|node|python|program|code)\b/i,
  /\b(?:execute|run|install)\b.{0,30}\b(?:plugin\s+code|guest\s+code|hook\s+code)\b/i,
  /\b(?:exfiltrate|steal|dump)\b.{0,30}\b(?:secret|password|token|credential|key)\b/i,
];

function intentKindForTool(toolName: string): HybridIntentKind {
  if (toolName.startsWith('memory_remember')) return 'memory.remember';
  if (toolName.startsWith('memory_recall')) return 'memory.recall';
  if (toolName.startsWith('memory_forget')) return 'memory.forget';
  if (toolName === 'create_task') return 'task.create';
  if (toolName === 'list_tasks') return 'task.list';
  if (toolName === 'complete_task') return 'task.complete';
  if (toolName === 'web_search' || toolName.endsWith('search_web')) return 'web.search';
  return 'unknown';
}

/** Deterministic first pass. The LLM is never consulted by this router. */
export function routeIntent(input: {
  text: string;
  agentConfig?: AgentConfig;
}): HybridIntent {
  const text = input.text.trim();

  if (!text) {
    return { kind: 'conversation', confidence: 0.2, calls: [], notes: [], decision: 'NEEDS_AI' };
  }

  if (PROHIBITED_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      kind: 'prohibited',
      confidence: 1,
      calls: [],
      notes: ['The request asks to bypass a safety boundary or execute untrusted code.'],
      decision: 'PROHIBITED',
    };
  }

  const route = routeDeterministically({ text, agentConfig: input.agentConfig });

  if (route.kind === 'denied') {
    return {
      kind: 'prohibited',
      confidence: 0.95,
      calls: [],
      notes: [route.reason],
      decision: 'PROHIBITED',
    };
  }

  if (route.kind === 'handled') {
    const calls = route.calls.map((call) => ({ toolName: call.toolName, args: call.args ?? {} }));
    if (calls.some((call) => isProhibitedCapability(call.toolName))) {
      return {
        kind: 'prohibited',
        confidence: 1,
        calls: [],
        notes: ['A deterministic rule proposed a prohibited capability.'],
        decision: 'PROHIBITED',
      };
    }
    return {
      kind: calls.length > 0 ? intentKindForTool(calls[0].toolName) : 'unknown',
      confidence: 0.96,
      calls,
      notes: ['Matched a conservative deterministic intent rule.'],
      decision: 'SAFE_AUTO',
    };
  }

  const calls = route.kind === 'partial'
    ? route.calls.map((call) => ({ toolName: call.toolName, args: call.args ?? {} }))
    : [];

  return {
    kind: calls.length > 0 ? intentKindForTool(calls[0].toolName) : 'conversation',
    confidence: route.kind === 'partial' ? 0.62 : 0.35,
    calls,
    notes: route.kind === 'partial' ? route.notes : ['No deterministic rule matched.'],
    decision: 'NEEDS_AI',
  };
}
