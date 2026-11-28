/**
 * Typed, read-only Buddy observation stream.
 *
 * This is deliberately app-owned and separate from the plugin event bus. UI,
 * Buddy chat, and plugins can subscribe, but they cannot publish, acknowledge,
 * mutate Agent state, approve actions, or reach execution APIs.
 */

import type { PriorityBucket } from './reward-policy';

export type BuddyEventType =
  | 'task_created'
  | 'task_started'
  | 'task_progress'
  | 'tool_started'
  | 'tool_completed'
  | 'approval_required'
  | 'task_waiting'
  | 'task_completed'
  | 'task_failed'
  | 'agent_idle'
  | 'user_interaction';

export type BuddyEventSourceKind = 'task' | 'runtime' | 'chat' | 'buddy';

export interface BuddyEventBase {
  eventKey: string;
  userId: number;
  occurredAt: number;
  source: BuddyEventSourceKind;
}

export type BuddyAgentEvent = BuddyEventBase &
  (
    | {
        type: 'task_created';
        taskId: string;
        kind: 'agent' | 'manual';
        priorityBucket: PriorityBucket;
      }
    | {
        type: 'task_started';
        taskId: string;
        phase: 'system' | 'ai' | 'verify' | 'done';
      }
    | {
        type: 'task_progress';
        taskId: string;
        progressKind: 'step' | 'verifying' | 'retry';
      }
    | {
        type: 'tool_started';
        taskId?: string;
        toolName: string;
      }
    | {
        type: 'tool_completed';
        taskId?: string;
        toolName: string;
        outcome: 'success' | 'failure' | 'denied';
        durationBucket: 'fast' | 'normal' | 'slow';
      }
    | {
        type: 'approval_required';
        taskId?: string;
        toolName: string;
        reasonCode: 'risk' | 'policy' | 'scope';
      }
    | {
        type: 'task_waiting';
        taskId: string;
        waitReason: 'approval' | 'review' | 'blocked';
      }
    | {
        type: 'task_completed';
        taskId: string;
        verified: boolean;
        priorityBucket: PriorityBucket;
      }
    | {
        type: 'task_failed';
        taskId: string;
        failureKind: 'failed' | 'cancelled' | 'blocked';
      }
    | {
        type: 'agent_idle';
        idleReason: 'turn_end' | 'no_active_operations';
      }
    | {
        type: 'user_interaction';
        interaction:
          | 'chat_message'
          | 'buddy_chat'
          | 'buddy_tap'
          | 'play'
          | 'feed'
          | 'pet'
          | 'train';
        surface: 'agent_chat' | 'buddy_home' | 'buddy_chat';
      }
  );

export type BuddyEventListener = (event: BuddyAgentEvent) => void;

const listeners = new Set<BuddyEventListener>();
const seenEventKeys = new Map<string, number>();
const MAX_SEEN_EVENT_KEYS = 2_000;

function pruneSeen(now: number): void {
  if (seenEventKeys.size <= MAX_SEEN_EVENT_KEYS) return;
  const cutoff = now - 10 * 60_000;
  for (const [key, timestamp] of seenEventKeys) {
    if (timestamp < cutoff) seenEventKeys.delete(key);
    if (seenEventKeys.size <= MAX_SEEN_EVENT_KEYS / 2) break;
  }
  while (seenEventKeys.size > MAX_SEEN_EVENT_KEYS) {
    const oldest = seenEventKeys.keys().next().value as string | undefined;
    if (!oldest) break;
    seenEventKeys.delete(oldest);
  }
}

/** Internal only: lifecycle adapters call this after a durable state change. */
export function publishBuddyEvent(event: BuddyAgentEvent): boolean {
  const now = event.occurredAt || Date.now();
  if (seenEventKeys.has(event.eventKey)) return false;
  seenEventKeys.set(event.eventKey, now);
  pruneSeen(now);

  const frozen = Object.freeze({ ...event });
  for (const listener of [...listeners]) {
    try {
      listener(frozen);
    } catch (error) {
      // Observation must never affect Agent execution.
      console.warn('Buddy event listener failed', error);
    }
  }
  return true;
}

/** Public read-only subscription surface. */
export function subscribeBuddyEvents(listener: BuddyEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only helper; production code has no reason to clear listeners. */
export function resetBuddyEventBus(): void {
  listeners.clear();
  seenEventKeys.clear();
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function djb2(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}

/**
 * Opaque but stable keys. Raw ids, trace ids and occurrence ids are hashed so
 * they never leak to Buddy subscribers through eventKey.
 */
export function makeBuddyEventKey(...parts: (string | number | null | undefined)[]): string {
  const raw = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .join(':');
  return `evt_${fnv1a(raw).toString(16).padStart(8, '0')}${djb2(raw).toString(16).padStart(8, '0')}`;
}

export function sanitizeToolName(raw: string | null | undefined): string {
  if (!raw) return 'tool';
  // Tool identifiers are single tokens. Any trailing arguments or path text are
  // discarded before allowlist cleanup so they cannot leak into Buddy events.
  const token = raw.trim().split(/\s+/)[0] ?? '';
  const cleaned = token
    .replace(/[^a-zA-Z0-9_.:-]/g, '')
    .replace(/[.:-]{2,}/g, '.')
    .replace(/^[.:-]+|[.:-]+$/g, '')
    .slice(0, 80);
  return cleaned || 'tool';
}

export function durationBucket(ms: number | undefined): 'fast' | 'normal' | 'slow' {
  const value = Math.max(0, ms ?? 0);
  if (value < 500) return 'fast';
  if (value < 5_000) return 'normal';
  return 'slow';
}

export function isValidPhase(raw: unknown): 'system' | 'ai' | 'verify' | 'done' {
  return raw === 'ai' || raw === 'verify' || raw === 'done' ? raw : 'system';
}
