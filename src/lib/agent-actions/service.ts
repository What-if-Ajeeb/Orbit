import type { SQLiteDatabase } from 'expo-sqlite';

import { agentToolRegistry } from '@/lib/ai/tool-registry';
import { classifyToolAction } from '@/lib/permissions/classifier';
import { permissionManager } from '@/lib/permissions/manager';
import { secureExecuteTool, type SecureToolExecution } from '@/lib/permissions/executor';
import { policyEngine } from '@/lib/policy';
import type {
  AgentIdentity,
  ClassifiedPermissionAction,
  PermissionOutcome,
} from '@/lib/permissions/types';

import { getAgentActionIntegration } from './integrations';
import {
  getAgentAction,
  insertAgentAction,
  updateAgentAction,
} from './store';
import type { AgentActionRecord, CreateAgentActionInput } from './types';

export { getAgentAction, listAgentActions } from './store';

const PROJECT_ID = 'orbit-agent-actions';
const PROJECT_LABEL = 'Agent actions';

type ApprovalTicket = {
  authorization: Extract<PermissionOutcome, { allowed: true }>['authorization'];
  request: Extract<PermissionOutcome, { allowed: true }>['request'];
};

const approvalPromises = new Map<string, Promise<PermissionOutcome>>();
const approvalTickets = new Map<string, ApprovalTicket>();
const controllers = new Map<string, AbortController>();
const inFlight = new Set<string>();

function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { __display: _display, ...rest } = payload;
  return rest;
}

function agentFromRecord(record: Pick<AgentActionRecord, 'agentId' | 'agentName'>): AgentIdentity {
  return {
    id: record.agentId,
    name: record.agentName,
    role: 'specialist',
    description: 'Agent action',
    icon: 'sparkles-outline',
  };
}

function classifyFor(
  input: Pick<AgentActionRecord, 'id' | 'agentId' | 'agentName' | 'kind' | 'toolName' | 'toolArgs'>
): ClassifiedPermissionAction {
  const action = classifyToolAction({
    toolName: input.toolName,
    args: input.toolArgs,
    agent: agentFromRecord(input),
    projectId: PROJECT_ID,
    projectLabel: PROJECT_LABEL,
  });

  return {
    ...action,
    metadata: {
      ...action.metadata,
      agentActionId: input.id,
      integration: input.kind,
      explicitCardConfirmation: true,
    },
  };
}

function activityBase(record: AgentActionRecord) {
  return {
    userId: record.userId,
    conversationId: record.conversationId,
    agentId: record.agentId,
    agentName: record.agentName,
    toolName: record.toolName,
    resourceKey: record.id,
    resourceLabel: record.target,
    category: record.category,
    risk: record.risk,
    metadata: {
      agentActionId: record.id,
      integration: record.kind,
      fingerprint: record.fingerprint,
    },
  };
}

async function logActivity(
  record: AgentActionRecord,
  status: 'pending' | 'approved' | 'running' | 'completed' | 'failed' | 'denied' | 'cancelled',
  result?: string,
  error?: string
): Promise<void> {
  const activityStatus = status === 'completed' ? 'success' : status;

  await permissionManager.recordActivity({
    ...activityBase(record),
    action: record.title,
    status: activityStatus,
    result,
    error,
  });
}

function nextRecord(record: AgentActionRecord, patch: Partial<AgentActionRecord>): AgentActionRecord {
  return { ...record, ...patch, updatedAt: Date.now() };
}

async function save(
  db: SQLiteDatabase,
  record: AgentActionRecord,
  patch: Partial<AgentActionRecord>
): Promise<AgentActionRecord> {
  const next = nextRecord(record, patch);
  await updateAgentAction(db, next);
  return next;
}

function fail(message: string): never {
  throw new Error(message);
}

/** Keeps the card in sync when approval happens in the global dialog instead. */
async function recordApprovedOutcome(
  db: SQLiteDatabase,
  actionId: string,
  outcome: Extract<PermissionOutcome, { allowed: true }>
): Promise<void> {
  if (approvalTickets.has(actionId)) {
    return;
  }

  const current = await getAgentAction(db, actionId);

  if (!current || current.status !== 'awaiting_approval') {
    return;
  }

  if (current.fingerprint !== outcome.request.fingerprint) {
    const invalid = await save(db, current, {
      status: 'draft',
      permissionRequestId: null,
      error: 'The payload changed before approval. Confirm the exact action again.',
    });
    await logActivity(invalid, 'cancelled', 'Approval invalidated by an edit before confirmation.');
    return;
  }

  approvalTickets.set(actionId, {
    authorization: outcome.authorization,
    request: outcome.request,
  });

  const next = await save(db, current, {
    status: 'approved',
    permissionRequestId: outcome.request.id,
    approvalFingerprint: current.fingerprint,
    approvedAt: Date.now(),
    error: null,
  });

  await logActivity(next, 'approved', 'Explicit confirmation recorded. Ready to execute.');
}

/** Keeps the card in sync when denial/cancel happens in another approval surface. */
async function recordDeniedOutcome(
  db: SQLiteDatabase,
  actionId: string,
  outcome: Extract<PermissionOutcome, { allowed: false }>
): Promise<void> {
  approvalPromises.delete(actionId);

  const current = await getAgentAction(db, actionId);

  if (!current || current.status !== 'awaiting_approval') {
    return;
  }

  const cancelled = outcome.reason === 'user_cancelled';
  const next = await save(db, current, {
    status: cancelled ? 'cancelled' : 'rejected',
    permissionRequestId: null,
    approvalFingerprint: null,
    error: null,
  });

  await logActivity(
    next,
    cancelled ? 'cancelled' : 'denied',
    outcome.message,
    cancelled ? undefined : outcome.message
  );
}

export async function createAgentAction(
  db: SQLiteDatabase,
  input: CreateAgentActionInput
): Promise<AgentActionRecord> {
  const id = input.id.trim();

  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) {
    fail('Action ID must be a short stable identifier.');
  }

  const existing = await getAgentAction(db, id);

  if (existing) {
    return existing;
  }

  const payload = cleanPayload(input.payload);
  const integration = getAgentActionIntegration(input.kind);

  if (!integration) {
    fail(`Unknown action integration: ${input.kind}`);
  }

  const validationError = integration.validate(payload);

  if (validationError) {
    fail(validationError);
  }

  const toolName =
    typeof integration.toolName === 'function'
      ? integration.toolName(payload)
      : integration.toolName;
  const toolArgs = integration.buildArgs(payload);

  if (!agentToolRegistry.get(toolName)) {
    fail(`The ${toolName} tool is not available in this app build.`);
  }

  const policy = policyEngine.evaluate(toolName, toolArgs);

  if (policy.decision === 'deny') {
    fail(`Blocked by policy: ${policy.reason ?? 'this action is not allowed.'}`);
  }

  const classified = classifyFor({
    id,
    agentId: input.agent.id,
    agentName: input.agent.name,
    kind: input.kind,
    toolName,
    toolArgs,
  });
  const display = integration.describe(payload);
  const now = Date.now();
  const record: AgentActionRecord = {
    id,
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    agentId: input.agent.id,
    agentName: input.agent.name,
    kind: input.kind,
    toolName,
    status: 'draft',
    title: display.title,
    target: display.target,
    lines: display.lines,
    payload,
    toolArgs,
    fingerprint: classified.fingerprint,
    permissionRequestId: null,
    risk: classified.risk,
    category: classified.category,
    approvalFingerprint: null,
    approvedAt: null,
    result: null,
    error: null,
    trace: null,
    createdAt: now,
    updatedAt: now,
  };

  await insertAgentAction(db, record);
  return (await getAgentAction(db, id)) ?? record;
}

function findPending(actionId: string) {
  return permissionManager
    .getState()
    .queue.find((request) => request.metadata.agentActionId === actionId);
}

function waitForPendingRequest(actionId: string): Promise<{
  id: string;
}> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: () => void = () => undefined;
    let settled = false;

    const settle = (request: { id: string } | null) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe();

      if (request) {
        resolve(request);
      } else {
        reject(new Error('The approval request expired before it could be shown. Request approval again.'));
      }
    };

    const check = () => {
      const request = findPending(actionId);

      if (request) {
        settle(request);
      }
    };

    unsubscribe = permissionManager.subscribe(check);
    check();
    timer = setTimeout(() => settle(null), 10_000);
  });
}

export async function requestActionApproval(
  db: SQLiteDatabase,
  actionId: string,
  userId: number
): Promise<AgentActionRecord> {
  const record = await getAgentAction(db, actionId);

  if (!record || record.userId !== userId) {
    fail('This action is not available.');
  }
  if (record.status !== 'draft') {
    fail('Only draft actions can request approval.');
  }

  // Move to the pending state before publishing the permission request. The
  // global approval dialog may be resolved while this function is still saving
  // the request id, and its reconciliation must see a pending card.
  const awaiting = await save(db, record, { status: 'awaiting_approval', permissionRequestId: null });
  await logActivity(awaiting, 'pending', 'Waiting for explicit confirmation on the action card.');

  const pendingLookup = waitForPendingRequest(actionId);
  const action = classifyFor(record);
  const outcomePromise = permissionManager.requestToolPermission({
    userId,
    conversationId: record.conversationId,
    action,
    // A card always requires an explicit decision, even when a policy or saved
    // grant would otherwise allow the tool automatically.
    policy: { decision: 'ask', ruleId: null },
  });

  approvalPromises.set(actionId, outcomePromise);
  void outcomePromise
    .then(async (outcome) => {
      if (outcome.allowed) {
        await recordApprovedOutcome(db, actionId, outcome);
      } else {
        await recordDeniedOutcome(db, actionId, outcome);
      }
    })
    .catch(() => approvalPromises.delete(actionId));

  try {
    const pending = await pendingLookup;
    const fresh = await getAgentAction(db, actionId);

    // Never overwrite a decision that arrived while the request id was saved.
    if (fresh?.status === 'awaiting_approval' && !fresh.permissionRequestId) {
      return save(db, fresh, { permissionRequestId: pending.id });
    }

    return fresh ?? awaiting;
  } catch (error) {
    approvalPromises.delete(actionId);
    const fresh = await getAgentAction(db, actionId);

    if (fresh?.status === 'awaiting_approval') {
      await save(db, fresh, { status: 'draft', permissionRequestId: null });
    }

    throw error;
  }
}

export async function approveAction(
  db: SQLiteDatabase,
  actionId: string,
  userId: number
): Promise<AgentActionRecord> {
  const record = await getAgentAction(db, actionId);

  if (!record || record.userId !== userId) {
    fail('This action is not available.');
  }
  if (record.status !== 'awaiting_approval') {
    fail('This action is not waiting for approval.');
  }
  if (record.fingerprint !== classifyFor(record).fingerprint) {
    return save(db, record, { status: 'draft', permissionRequestId: null });
  }

  const outcomePromise = approvalPromises.get(actionId);

  if (!outcomePromise) {
    fail('This approval expired. Request approval again.');
  }

  const requestId = record.permissionRequestId ?? findPending(actionId)?.id;

  if (!requestId) {
    fail('The permission request expired. Request approval again.');
  }

  const resolved = await permissionManager.resolveRequest(requestId, 'allow_once', userId);

  if (!resolved.ok) {
    fail(resolved.message ?? 'Approval could not be recorded.');
  }

  const outcome = await outcomePromise;

  if (!outcome.allowed) {
    const next = await save(db, record, {
      status: 'failed',
      error: outcome.message,
      permissionRequestId: null,
    });
    await logActivity(next, 'failed', undefined, outcome.message);
    fail(outcome.message);
  }

  await recordApprovedOutcome(db, actionId, outcome);

  const next = await getAgentAction(db, actionId);

  if (!next || next.status !== 'approved') {
    fail('Approval could not be recorded on this card.');
  }

  return next;
}

export async function editAction(
  db: SQLiteDatabase,
  actionId: string,
  userId: number,
  payload: Record<string, unknown>
): Promise<AgentActionRecord> {
  const record = await getAgentAction(db, actionId);

  if (!record || record.userId !== userId) {
    fail('This action is not available.');
  }
  if (record.status === 'executing' || record.status === 'completed') {
    fail('This action can no longer be edited.');
  }

  const wasApproved = record.status === 'approved';
  const clean = cleanPayload(payload);
  const integration = getAgentActionIntegration(record.kind);

  if (!integration) {
    fail(`Unknown action integration: ${record.kind}`);
  }

  const validationError = integration.validate(clean);

  if (validationError) {
    fail(validationError);
  }

  const toolName =
    typeof integration.toolName === 'function' ? integration.toolName(clean) : integration.toolName;
  const toolArgs = integration.buildArgs(clean);

  if (!agentToolRegistry.get(toolName)) {
    fail(`The ${toolName} tool is not available in this app build.`);
  }

  const classified = classifyFor({
    ...record,
    toolName,
    toolArgs,
  });
  const display = integration.describe(clean);

  controllers.get(actionId)?.abort();
  controllers.delete(actionId);
  approvalTickets.delete(actionId);
  approvalPromises.delete(actionId);

  if (record.permissionRequestId) {
    await permissionManager.cancelRequest(record.permissionRequestId, userId);
  }

  const next = await save(db, record, {
    status: 'draft',
    title: display.title,
    target: display.target,
    lines: display.lines,
    payload: clean,
    toolArgs,
    toolName,
    fingerprint: classified.fingerprint,
    risk: classified.risk,
    category: classified.category,
    permissionRequestId: null,
    approvalFingerprint: null,
    approvedAt: null,
    result: null,
    error: wasApproved ? 'The payload changed. Approval was invalidated.' : null,
    trace: null,
  });

  await permissionManager.recordAudit({
    userId,
    requestId: record.permissionRequestId,
    agentId: record.agentId,
    event: 'cancelled',
    category: record.category,
    risk: record.risk,
    toolName: record.toolName,
    projectId: PROJECT_ID,
    detail: `Action ${actionId} was edited; any approval was invalidated.`,
  });
  await logActivity(next, 'cancelled', 'Action payload changed. Approval invalidated.');
  return next;
}

export async function rejectAction(
  db: SQLiteDatabase,
  actionId: string,
  userId: number
): Promise<AgentActionRecord> {
  const record = await getAgentAction(db, actionId);

  if (!record || record.userId !== userId) {
    fail('This action is not available.');
  }

  if (record.permissionRequestId) {
    await permissionManager.resolveRequest(record.permissionRequestId, 'deny', userId);
  }

  controllers.get(actionId)?.abort();
  approvalTickets.delete(actionId);
  approvalPromises.delete(actionId);

  const next = await save(db, record, {
    status: 'rejected',
    permissionRequestId: null,
    approvalFingerprint: null,
    error: null,
  });

  await permissionManager.recordAudit({
    userId,
    requestId: record.permissionRequestId,
    agentId: record.agentId,
    event: 'denied',
    category: record.category,
    risk: record.risk,
    toolName: record.toolName,
    projectId: PROJECT_ID,
    detail: `Action ${actionId} was rejected by the user.`,
  });
  await logActivity(next, 'denied', 'You rejected this action. Nothing was executed.');
  return next;
}

export async function cancelAction(
  db: SQLiteDatabase,
  actionId: string,
  userId: number
): Promise<AgentActionRecord> {
  const record = await getAgentAction(db, actionId);

  if (!record || record.userId !== userId) {
    fail('This action is not available.');
  }

  if (record.permissionRequestId) {
    await permissionManager.cancelRequest(record.permissionRequestId, userId);
  }

  controllers.get(actionId)?.abort();
  approvalTickets.delete(actionId);
  approvalPromises.delete(actionId);

  const next = await save(db, record, {
    status: 'cancelled',
    permissionRequestId: null,
    approvalFingerprint: null,
    result: null,
  });

  await logActivity(next, 'cancelled', 'You cancelled this action. No execution was started.');
  return next;
}

export async function executeAction(
  db: SQLiteDatabase,
  actionId: string,
  userId: number
): Promise<SecureToolExecution> {
  // Reserve the action synchronously so two callers cannot both pass the
  // duplicate check while the first is waiting on its database read.
  if (inFlight.has(actionId)) {
    fail('This action is already executing.');
  }
  inFlight.add(actionId);

  try {
    return await executeReservedAction(db, actionId, userId);
  } finally {
    inFlight.delete(actionId);
  }
}

async function executeReservedAction(
  db: SQLiteDatabase,
  actionId: string,
  userId: number
): Promise<SecureToolExecution> {
  const record = await getAgentAction(db, actionId);

  if (!record || record.userId !== userId) {
    fail('This action is not available.');
  }
  if (record.status !== 'approved') {
    fail('Only explicitly approved actions can execute.');
  }
  if (record.approvalFingerprint !== record.fingerprint) {
    const invalid = await save(db, record, {
      status: 'draft',
      approvalFingerprint: null,
      permissionRequestId: null,
      error: 'The payload changed after approval. Confirm the exact action again.',
    });
    await logActivity(invalid, 'cancelled', 'Approval invalidated before execution.');
    fail(invalid.error ?? 'Approval is no longer valid.');
  }

  const ticket = approvalTickets.get(actionId);

  if (!ticket) {
    fail('The approval token expired. Request approval again.');
  }

  const validationError = getAgentActionIntegration(record.kind)?.validate(cleanPayload(record.payload));

  if (validationError) {
    const invalid = await save(db, record, {
      status: 'failed',
      error: validationError,
    });
    await logActivity(invalid, 'failed', undefined, validationError);
    fail(validationError);
  }

  const tool = agentToolRegistry.get(record.toolName);

  if (!tool) {
    fail(`The ${record.toolName} tool is no longer available.`);
  }

  const policy = policyEngine.evaluate(record.toolName, record.toolArgs);

  if (policy.decision === 'deny') {
    const blocked = await save(db, record, {
      status: 'failed',
      error: `Blocked by policy: ${policy.reason ?? 'this action is not allowed.'}`,
    });
    await logActivity(blocked, 'failed', undefined, blocked.error ?? 'Blocked by policy.');
    fail(blocked.error ?? 'Blocked by policy.');
  }

  const controller = new AbortController();
  controllers.set(actionId, controller);

  try {
    const running = await save(db, record, { status: 'executing', error: null });
    await logActivity(running, 'running', 'Executing the confirmed action.');

    const secured = await secureExecuteTool({
      db,
      userId,
      agent: agentFromRecord(record),
      conversationId: record.conversationId,
      projectId: PROJECT_ID,
      projectLabel: PROJECT_LABEL,
      toolName: record.toolName,
      rawArguments: JSON.stringify(record.toolArgs),
      policy: { decision: policy.decision, ruleId: policy.ruleId, reason: policy.reason },
      timeoutMs: tool.timeoutMs,
      signal: controller.signal,
      authorization: ticket.authorization,
      authorizationRequest: ticket.request,
      execute: (signal) =>
        tool.execute(
          {
            db,
            userId,
            conversationId: record.conversationId ?? undefined,
            signal,
            agent: agentFromRecord(record),
          },
          record.toolArgs
        ),
    });

    const final = await getAgentAction(db, actionId);

    if (!final || final.status !== 'executing') {
      fail('This action was stopped while it was executing.');
    }

    const completed = await save(db, final, {
      status: secured.success ? 'completed' : 'failed',
      result: secured.content,
      error: secured.error ?? null,
      trace: secured.trace,
    });

    await logActivity(
      completed,
      secured.success ? 'completed' : 'failed',
      secured.content,
      secured.error
    );

    return secured;
  } catch (error) {
    const current = await getAgentAction(db, actionId);

    if (current?.status === 'executing') {
      const failed = await save(db, current, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Execution failed.',
      });
      await logActivity(failed, 'failed', undefined, failed.error ?? 'Execution failed.');
    }

    throw error;
  } finally {
    controllers.delete(actionId);
    approvalTickets.delete(actionId);
    approvalPromises.delete(actionId);
  }
}

export function parseAgentActionRef(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { ok?: unknown; actionId?: unknown };

    if (parsed.ok === true && typeof parsed.actionId === 'string') {
      return parsed.actionId;
    }
  } catch {
    // The human-readable trace from the propose tool is also accepted below.
  }

  const match = /action_[0-9]{10,}_[A-Za-z0-9_-]{4,}/.exec(content);
  return match ? match[0] : null;
}

export const AGENT_ACTION_PROJECT_ID = PROJECT_ID;
