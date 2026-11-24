import type { PluginPermission, PluginTrustLevel } from './types';

export type PluginPermissionApprovalInput = {
  kind: 'permissions';
  pluginId: string;
  pluginName: string;
  trustLevel: PluginTrustLevel;
  permissions: PluginPermission[];
  reason: string;
};

export type PluginToolApprovalInput = {
  kind: 'tool';
  pluginId: string;
  pluginName: string;
  trustLevel: PluginTrustLevel;
  toolName: string;
  permissions: PluginPermission[];
  reason: string;
};

export type PluginApprovalInput =
  | PluginPermissionApprovalInput
  | PluginToolApprovalInput;

export type PluginApprovalRequest = PluginApprovalInput & {
  id: number;
  createdAt: number;
  expiresAt: number;
};

type Resolver = (approved: boolean) => void;

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Host-neutral approval queue. The PluginApprovalHost component renders the
 * pending request; the platform awaits a boolean. Every request defaults to
 * denied: timeouts, unmounts and missing hosts all resolve `false`.
 */
export class PluginApprovalService {
  private nextId = 1;
  private pending: (PluginApprovalRequest & { resolve: Resolver }) | null = null;
  private queue: (PluginApprovalRequest & { resolve: Resolver })[] = [];
  private listeners = new Set<() => void>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch {
        // A broken listener must not block the approval queue.
      }
    }
  }

  private enqueue(
    input: PluginApprovalInput,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<boolean> {
    if (this.pending || this.queue.length > 0) {
      // Only one modal is shown at a time; later requests queue behind it.
    }

    return new Promise<boolean>((resolve) => {
      const now = Date.now();
      const request: PluginApprovalRequest & { resolve: Resolver } = {
        ...input,
        id: this.nextId,
        createdAt: now,
        expiresAt: now + timeoutMs,
        resolve,
      };
      this.nextId += 1;
      this.queue.push(request);

      const timer = setTimeout(() => {
        this.expire(request.id, false);
      }, timeoutMs);
      this.timers.set(request.id, timer);

      this.promote();
      this.notify();
    });
  }

  requestPermissions(
    input: Omit<PluginPermissionApprovalInput, 'kind'>,
    timeoutMs?: number
  ): Promise<boolean> {
    return this.enqueue({ ...input, kind: 'permissions' }, timeoutMs);
  }

  requestTool(
    input: Omit<PluginToolApprovalInput, 'kind'>,
    timeoutMs?: number
  ): Promise<boolean> {
    return this.enqueue({ ...input, kind: 'tool' }, timeoutMs);
  }

  private promote(): void {
    if (this.pending) {
      return;
    }

    const next = this.queue.shift();

    if (next) {
      this.pending = next;
    }
  }

  private settle(id: number, approved: boolean): void {
    const request = this.pending;

    if (!request || request.id !== id) {
      return;
    }

    this.pending = null;
    const timer = this.timers.get(id);

    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    request.resolve(approved);
    this.promote();
    this.notify();
  }

  approve(id: number): void {
    this.settle(id, true);
  }

  deny(id: number): void {
    this.settle(id, false);
  }

  expire(id: number, approved = false): void {
    this.settle(id, approved);
  }

  getPending(): PluginApprovalRequest | null {
    if (!this.pending) {
      return null;
    }

    const { resolve: _resolve, ...request } = this.pending;
    void _resolve;
    return request;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }

  /** Rejects every pending request. Called when the host unmounts. */
  denyAll(): void {
    const requests = [...this.queue];

    if (this.pending) {
      requests.unshift(this.pending);
    }

    for (const request of requests) {
      this.settle(request.id, false);
    }

    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.pending = null;
    this.queue = [];
    this.notify();
  }
}

export const pluginApprovalService = new PluginApprovalService();
