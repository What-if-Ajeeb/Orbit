import type { HybridTaskState } from './types';

/** Legacy SQLite status values kept for compatibility with v16 consumers. */
export type LegacyTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_tool'
  | 'blocked'
  | 'paused'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

const CANONICAL_TO_LEGACY: Record<HybridTaskState, LegacyTaskStatus> = {
  QUEUED: 'queued',
  PLANNING: 'running',
  RUNNING: 'running',
  WAITING_FOR_APPROVAL: 'awaiting_approval',
  VERIFYING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  // v16 used needs_review for work that may have side effects but no proof.
  BLOCKED: 'needs_review',
};

const LEGACY_TO_CANONICAL: Record<string, HybridTaskState> = {
  queued: 'QUEUED',
  running: 'RUNNING',
  awaiting_approval: 'WAITING_FOR_APPROVAL',
  awaiting_tool: 'WAITING_FOR_APPROVAL',
  blocked: 'BLOCKED',
  needs_review: 'BLOCKED',
  completed: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
  paused: 'BLOCKED',
  unknown: 'BLOCKED',
};

export function toLegacyStatus(state: HybridTaskState): LegacyTaskStatus {
  return CANONICAL_TO_LEGACY[state];
}

export function fromLegacyStatus(status: string | null | undefined): HybridTaskState {
  return LEGACY_TO_CANONICAL[status ?? ''] ?? 'BLOCKED';
}

const TRANSITIONS: Record<HybridTaskState, readonly HybridTaskState[]> = {
  QUEUED: ['PLANNING', 'BLOCKED'],
  PLANNING: ['RUNNING', 'WAITING_FOR_APPROVAL', 'BLOCKED', 'FAILED', 'CANCELLED'],
  RUNNING: ['WAITING_FOR_APPROVAL', 'VERIFYING', 'BLOCKED', 'FAILED', 'CANCELLED'],
  WAITING_FOR_APPROVAL: ['RUNNING', 'VERIFYING', 'BLOCKED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'FAILED', 'BLOCKED'],
  COMPLETED: [],
  FAILED: ['PLANNING'],
  CANCELLED: [],
  BLOCKED: ['PLANNING', 'RUNNING', 'FAILED', 'CANCELLED'],
};

export const TERMINAL_STATES: readonly HybridTaskState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function canTransition(from: HybridTaskState, to: HybridTaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: HybridTaskState, to: HybridTaskState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid hybrid task transition: ${from} -> ${to}`);
  }
}
