import type { BuddyAgentEvent, BuddyEventType } from '../events';

/** Reaction limits. Approval and terminal events stay immediate. */
export const EVENT_COOLDOWN_MS: Record<BuddyEventType, number> = {
  task_created: 1_000,
  task_started: 1_000,
  task_progress: 3_000,
  tool_started: 1_500,
  tool_completed: 1_500,
  approval_required: 0,
  task_waiting: 2_000,
  task_completed: 0,
  task_failed: 0,
  agent_idle: 5_000,
  user_interaction: 600,
};

function scopeFor(event: BuddyAgentEvent): string {
  switch (event.type) {
    case 'task_created':
    case 'task_started':
    case 'task_progress':
    case 'task_waiting':
    case 'task_completed':
    case 'task_failed':
      return `${event.type}:${event.taskId}`;
    case 'tool_started':
    case 'tool_completed':
      return `${event.type}:${event.toolName}`;
    case 'approval_required':
      return `${event.type}:${event.toolName}`;
    case 'agent_idle':
      return event.type;
    case 'user_interaction':
      return `${event.type}:${event.interaction}`;
  }
}

/**
 * Small in-memory throttle. It never blocks Agent work; it only decides
 * whether the Buddy layer should show a compact reaction.
 */
export class BuddyCooldowns {
  private lastByScope = new Map<string, number>();

  shouldPresent(event: BuddyAgentEvent, now = Date.now()): boolean {
    const window = EVENT_COOLDOWN_MS[event.type];
    if (window <= 0) return true;
    const scope = scopeFor(event);
    const last = this.lastByScope.get(scope);
    if (last !== undefined && now - last < window) return false;
    this.lastByScope.set(scope, now);
    if (this.lastByScope.size > 500) {
      const cutoff = now - 60_000;
      for (const [key, timestamp] of this.lastByScope) {
        if (timestamp < cutoff) this.lastByScope.delete(key);
      }
    }
    return true;
  }

  reset(): void {
    this.lastByScope.clear();
  }
}
