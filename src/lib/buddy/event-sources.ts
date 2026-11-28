/**
 * Sanitizing adapters from real Agent lifecycle seam data to Buddy observations.
 *
 * Only the fields listed here cross into the Buddy layer. Raw arguments,
 * results, errors, prompts, paths, URLs, grants, and approval IDs are dropped.
 */

import {
  durationBucket,
  isValidPhase,
  makeBuddyEventKey,
  publishBuddyEvent,
  sanitizeToolName,
  type BuddyAgentEvent,
} from './events';
import { priorityBucketFromNumber, type PriorityBucket } from './reward-policy';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function priority(value: unknown): PriorityBucket {
  return priorityBucketFromNumber(number(value));
}

export function publishTaskLifecycleEvent(input: {
  userId: number;
  taskId: string;
  type: string;
  eventId: string | number;
  occurredAt?: number;
  payload?: Record<string, unknown>;
}): boolean {
  const { userId, taskId, type, eventId } = input;
  const occurredAt = input.occurredAt ?? Date.now();
  const payload = input.payload ?? {};
  const base = {
    userId,
    occurredAt,
    source: 'task' as const,
  };

  let event: BuddyAgentEvent | null = null;

  if (type === 'task.created') {
    const rawKind = text(payload.kind) ?? 'turn';
    event = {
      ...base,
      type: 'task_created',
      eventKey: makeBuddyEventKey('task', userId, taskId, eventId, 'created'),
      taskId,
      kind: rawKind === 'manual' ? 'manual' : 'agent',
      priorityBucket: priority(payload.priority ?? payload.priorityBucket),
    };
  } else if (type.startsWith('task.')) {
    const status = type.slice('task.'.length);
    const eventKey = makeBuddyEventKey('task', userId, taskId, eventId, status);
    if (status === 'running' || status === 'queued' || status === 'claimed') {
      event = {
        ...base,
        type: 'task_started',
        eventKey,
        taskId,
        phase: isValidPhase(payload.phase),
      };
    } else if (status === 'awaiting_approval' || status === 'awaiting_tool') {
      event = {
        ...base,
        type: 'task_waiting',
        eventKey,
        taskId,
        waitReason: 'approval',
      };
    } else if (status === 'needs_review' || status === 'blocked' || status === 'paused' || status === 'unknown') {
      event = {
        ...base,
        type: 'task_waiting',
        eventKey,
        taskId,
        waitReason: status === 'blocked' ? 'blocked' : 'review',
      };
    } else if (status === 'completed') {
      event = {
        ...base,
        type: 'task_completed',
        eventKey,
        taskId,
        verified: boolean(payload.verified),
        priorityBucket: priority(payload.priority ?? payload.priorityBucket),
      };
    } else if (status === 'failed' || status === 'cancelled') {
      event = {
        ...base,
        type: 'task_failed',
        eventKey,
        taskId,
        failureKind: status === 'cancelled' ? 'cancelled' : 'failed',
      };
    } else if (status === 'recovered') {
      const to = text(payload.to) ?? 'queued';
      event = to === 'queued' || to === 'running'
        ? {
            ...base,
            type: 'task_started',
            eventKey,
            taskId,
            phase: 'system',
          }
        : {
            ...base,
            type: 'task_waiting',
            eventKey,
            taskId,
            waitReason: 'blocked',
          };
    }
  }

  return event ? publishBuddyEvent(event) : false;
}

export function publishRuntimeEvent(input: {
  userId: number;
  taskId?: string;
  type: 'tool_call' | 'tool_result' | 'step_started' | 'step_ended';
  payload: Record<string, unknown>;
  occurredAt?: number;
}): boolean {
  const { userId, type, payload } = input;
  const occurredAt = input.occurredAt ?? Date.now();
  const taskId = input.taskId;
  const toolName = sanitizeToolName(text(payload.toolName));
  const traceId = text(payload.traceId) ?? '';
  const stepId = text(payload.stepId) ?? '';
  const base = {
    userId,
    occurredAt,
    source: 'runtime' as const,
    ...(taskId ? { taskId } : {}),
  };

  let event: BuddyAgentEvent | null = null;
  if (type === 'tool_call') {
    event = {
      ...base,
      type: 'tool_started',
      eventKey: makeBuddyEventKey('tool', userId, traceId, stepId, toolName, 'started'),
      toolName,
    };
  } else if (type === 'tool_result') {
    const outcome = boolean(payload.denied)
      ? 'denied'
      : boolean(payload.success)
        ? 'success'
        : 'failure';
    event = {
      ...base,
      type: 'tool_completed',
      eventKey: makeBuddyEventKey('tool', userId, traceId, stepId, toolName, 'completed'),
      toolName,
      outcome,
      durationBucket: durationBucket(number(payload.durationMs)),
    };
  } else if (type === 'step_started') {
    event = {
      ...base,
      type: 'task_progress',
      taskId: taskId ?? '',
      eventKey: makeBuddyEventKey('progress', userId, taskId ?? '', traceId, text(payload.round) ?? '0'),
      progressKind: 'step',
    };
  } else {
    event = {
      ...base,
      type: 'task_progress',
      taskId: taskId ?? '',
      eventKey: makeBuddyEventKey('progress', userId, taskId ?? '', traceId, `end-${text(payload.round) ?? '0'}`),
      progressKind: 'verifying',
    };
  }

  if (event?.type === 'task_progress' && !event.taskId) return false;
  return event ? publishBuddyEvent(event) : false;
}

export function publishApprovalRequired(input: {
  userId: number;
  taskId?: string;
  toolName: string;
  reasonCode: 'risk' | 'policy' | 'scope';
  occurrenceId: string;
  occurredAt?: number;
}): boolean {
  return publishBuddyEvent({
    userId: input.userId,
    occurredAt: input.occurredAt ?? Date.now(),
    source: 'runtime',
    type: 'approval_required',
    eventKey: makeBuddyEventKey('approval', input.userId, input.occurrenceId, 'required'),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    toolName: sanitizeToolName(input.toolName),
    reasonCode: input.reasonCode,
  });
}

export function publishAgentIdle(
  userId: number,
  taskId?: string,
  occurredAt?: number
): boolean {
  return publishBuddyEvent({
    userId,
    occurredAt: occurredAt ?? Date.now(),
    source: 'runtime',
    type: 'agent_idle',
    eventKey: makeBuddyEventKey('idle', userId, taskId ?? 'session', occurredAt ?? Date.now()),
    idleReason: 'turn_end',
  });
}

export function publishUserInteraction(input: {
  userId: number;
  interaction: 'chat_message' | 'buddy_chat' | 'buddy_tap' | 'play' | 'feed' | 'pet' | 'train';
  surface: 'agent_chat' | 'buddy_home' | 'buddy_chat';
  occurrenceId: string;
  occurredAt?: number;
}): boolean {
  return publishBuddyEvent({
    userId: input.userId,
    occurredAt: input.occurredAt ?? Date.now(),
    source: input.surface === 'agent_chat' ? 'chat' : 'buddy',
    type: 'user_interaction',
    eventKey: makeBuddyEventKey('interaction', input.userId, input.surface, input.occurrenceId),
    interaction: input.interaction,
    surface: input.surface,
  });
}
