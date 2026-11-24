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

/** Host-neutral, read-only facts shown before an install is authorized. */
export type PluginInstallInspection = {
  pluginId: string;
  pluginName: string;
  version: string;
  publisherId: string;
  publisherName: string;
  publisherVerified: boolean;
  trustLevel: PluginTrustLevel;
  registry: string;
  compatible: boolean;
  minimumOrbitVersion: string;
  platformSupport: string[];
  entryPointKind: string;
  dependencies: {
    pluginId: string;
    name: string;
    version: string;
    installed: boolean;
    running: boolean;
  }[];
  sensitivePermissions: PluginPermission[];
  requiresSandbox: boolean;
  warnings: string[];
};

export type ApprovalRequestOptions = {
  timeoutMs?: number;
  /** Aborting the request denies it, including while it is still queued. */
  signal?: AbortSignal;
  /** Receives the native approval request id as soon as it is enqueued. */
  onRequest?: (requestId: number) => void;
};

export type PluginInstallApprovalInput = {
  kind: 'install';
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  trustLevel: PluginTrustLevel;
  capability: string;
  capabilityLabel: string;
  reason: string;
  permissions: PluginPermission[];
  sensitivePermissions: PluginPermission[];
  dependencies: {
    pluginId: string;
    name: string;
    version: string;
    permissions: PluginPermission[];
    installed?: boolean;
    running?: boolean;
  }[];
  requiresSandbox: boolean;
  requiresUpdate: boolean;
  steps: string[];
  inspection?: PluginInstallInspection;
};

export type PluginApprovalInput =
  | PluginPermissionApprovalInput
  | PluginToolApprovalInput
  | PluginInstallApprovalInput;

export type PluginApprovalRequest = PluginApprovalInput & {
  id: number;
  createdAt: number;
  expiresAt: number;
};

type Resolver = (approved: boolean) => void;

type QueuedRequest = PluginApprovalRequest & {
  resolve: Resolver;
  cleanup?: () => void;
};

const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeOptions(
  options: number | ApprovalRequestOptions = {}
): ApprovalRequestOptions {
  return typeof options === 'number' ? { timeoutMs: options } : options;
}

/**
 * Host-neutral approval queue. The PluginApprovalHost component renders the
 * pending request; the platform awaits a boolean. Every request defaults to
 * denied: timeouts, unmounts and missing hosts all resolve `false`.
 */
export class PluginApprovalService {
  private nextId = 1;
  private pending: QueuedRequest | null = null;
  private queue: QueuedRequest[] = [];
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
    options: number | ApprovalRequestOptions = {}
  ): Promise<boolean> {
    const normalized = normalizeOptions(options);
    const timeoutMs = normalized.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<boolean>((resolve) => {
      if (normalized.signal?.aborted) {
        resolve(false);
        return;
      }

      const now = Date.now();
      const request: QueuedRequest = {
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

      if (normalized.signal) {
        const onAbort = () => {
          this.expire(request.id, false);
        };
        normalized.signal.addEventListener('abort', onAbort, { once: true });
        request.cleanup = () => {
          normalized.signal?.removeEventListener('abort', onAbort);
        };
      }

      normalized.onRequest?.(request.id);
      this.promote();
      this.notify();
    });
  }

  requestPermissions(
    input: Omit<PluginPermissionApprovalInput, 'kind'>,
    options?: number | ApprovalRequestOptions
  ): Promise<boolean> {
    return this.enqueue({ ...input, kind: 'permissions' }, options);
  }

  requestTool(
    input: Omit<PluginToolApprovalInput, 'kind'>,
    options?: number | ApprovalRequestOptions
  ): Promise<boolean> {
    return this.enqueue({ ...input, kind: 'tool' }, options);
  }

  requestInstall(
    input: Omit<PluginInstallApprovalInput, 'kind'>,
    options?: number | ApprovalRequestOptions
  ): Promise<boolean> {
    return this.enqueue({ ...input, kind: 'install' }, options);
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
    const pending = this.pending;
    const isPending = pending?.id === id;
    const queuedIndex = isPending ? -1 : this.queue.findIndex((item) => item.id === id);

    if (!isPending && queuedIndex < 0) {
      return;
    }

    let request: QueuedRequest;

    if (isPending && pending) {
      request = pending;
      this.pending = null;
    } else {
      const [queued] = this.queue.splice(queuedIndex, 1);

      if (!queued) {
        return;
      }

      request = queued;
    }

    const timer = this.timers.get(id);

    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    request.cleanup?.();
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

    const { resolve: _resolve, cleanup: _cleanup, ...request } = this.pending;
    void _resolve;
    void _cleanup;
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
