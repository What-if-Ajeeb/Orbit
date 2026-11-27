import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createAgentTaskApproval,
  getAgentTask,
  getAgentTaskApproval,
  updateAgentTaskApproval,
  updateAgentTaskStatus,
} from '../agent-runtime/task-manager';

import { recordHybridEvent } from './audit';
import { assertTransition } from './state';
import type {
  ApprovalBinding,
  ApprovalState,
  HybridRiskDecision,
  HybridTraceContext,
} from './types';

const APPROVAL_TTL_MS = 10 * 60_000;

export function buildApprovalBinding(input: {
  taskId: string;
  stepId: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: HybridRiskDecision;
  scopeKey?: string;
  resourceKey?: string;
  policyVersion?: string;
}): ApprovalBinding {
  return {
    taskId: input.taskId,
    stepId: input.stepId,
    toolName: input.toolName,
    operationFingerprint: input.risk.operationFingerprint,
    scopeKey: input.scopeKey ?? '',
    resourceKey: input.resourceKey ?? '',
    policyVersion: input.policyVersion ?? '3',
    requestedAt: Date.now(),
  };
}

export function approvalStillMatches(
  approved: ApprovalBinding,
  current: ApprovalBinding
): boolean {
  return (
    approved.taskId === current.taskId &&
    approved.stepId === current.stepId &&
    approved.toolName === current.toolName &&
    approved.operationFingerprint === current.operationFingerprint &&
    approved.scopeKey === current.scopeKey &&
    approved.resourceKey === current.resourceKey &&
    approved.policyVersion === current.policyVersion
  );
}

export function approvalExpired(binding: ApprovalBinding, now = Date.now()): boolean {
  return now - binding.requestedAt > APPROVAL_TTL_MS;
}

/** Moves the durable task into WAITING_FOR_APPROVAL before any sensitive call. */
export async function enterApprovalWait(input: {
  db: SQLiteDatabase;
  taskId: string;
  userId: number;
  binding: ApprovalBinding;
  trace: HybridTraceContext;
  permissionRequestId?: string | null;
}): Promise<string> {
  const task = await getAgentTask(input.db, input.taskId);
  if (!task) throw new Error('The hybrid task no longer exists.');

  const from = task.hybridState ?? 'RUNNING';
  assertTransition(from, 'WAITING_FOR_APPROVAL');

  const id = `approval_${Crypto.randomUUID()}`;
  await createAgentTaskApproval(input.db, {
    id,
    taskId: input.taskId,
    stepId: input.binding.stepId,
    userId: input.userId,
    permissionRequestId: input.permissionRequestId ?? null,
    binding: JSON.stringify(input.binding),
    state: 'pending',
    operationFingerprint: input.binding.operationFingerprint,
    policyVersion: input.binding.policyVersion,
  });

  await updateAgentTaskStatus(input.db, input.taskId, 'awaiting_approval', {
    phase: 'system',
    hybridState: 'WAITING_FOR_APPROVAL',
    traceId: input.trace.traceId,
  });

  await recordHybridEvent(input.db, {
    traceId: input.trace.traceId,
    taskId: input.taskId,
    userId: input.userId,
    source: 'approvals',
    type: 'approval.waiting',
    payload: { approvalId: id, binding: input.binding },
  });

  return id;
}

/** Leaves WAITING_FOR_APPROVAL; an expired or mismatched approval blocks the task. */
export async function resolveApprovalWait(input: {
  db: SQLiteDatabase;
  approvalId: string;
  taskId: string;
  userId: number;
  binding: ApprovalBinding;
  trace: HybridTraceContext;
  granted: boolean;
  permissionRequestId?: string | null;
}): Promise<ApprovalState> {
  const record = await getAgentTaskApproval(input.db, input.approvalId);
  if (!record) return 'invalidated';

  let state: ApprovalState = input.granted ? 'approved' : 'denied';
  if (state === 'approved') {
    try {
      const saved = JSON.parse(record.binding) as ApprovalBinding;
      if (!approvalStillMatches(saved, input.binding) || approvalExpired(input.binding)) {
        state = 'invalidated';
      }
    } catch {
      state = 'invalidated';
    }
  }

  await updateAgentTaskApproval(input.db, input.approvalId, {
    state,
    resolvedAt: Date.now(),
    permissionRequestId: input.permissionRequestId ?? undefined,
  });

  const next = state === 'approved' ? 'RUNNING' : 'BLOCKED';
  await updateAgentTaskStatus(input.db, input.taskId, state === 'approved' ? 'running' : 'blocked', {
    hybridState: next,
    phase: state === 'approved' ? 'system' : 'verify',
    traceId: input.trace.traceId,
    ...(state === 'approved' ? {} : { error: 'Approval was denied, expired, or invalidated.' }),
  });

  await recordHybridEvent(input.db, {
    traceId: input.trace.traceId,
    taskId: input.taskId,
    userId: input.userId,
    source: 'approvals',
    type: `approval.${state}`,
    payload: { approvalId: input.approvalId, binding: input.binding },
  });

  return state;
}
