import type { PluginPermission, PluginTrustLevel } from './types';

export type OrbitEventMap = {
  'plugin.discovered': { pluginId: string; version: string };
  'plugin.installed': { pluginId: string; version: string; trustLevel: PluginTrustLevel };
  'plugin.enabled': { pluginId: string; version: string };
  'plugin.disabled': { pluginId: string; version: string; reason?: string };
  'plugin.error': { pluginId: string; error: string; hook?: string };
  'plugin.updated': { pluginId: string; fromVersion: string; toVersion: string };
  'plugin.uninstalled': { pluginId: string; version: string; deletedData: boolean };
  'plugin.permission.changed': {
    pluginId: string;
    permission: PluginPermission;
    granted: boolean;
  };
  'plugin.action': { pluginId: string; actionId: string; event: string };
  'user.authenticated': { userId: number; name: string };
  'user.signedOut': { userId: number | null };
  'task.created': { taskId: number; title: string };
  'task.completed': { taskId: number; title: string };
  'mcp.connected': { serverId: string; serverName: string; toolCount: number };
  'mcp.disconnected': { serverId: string; serverName: string; reason?: string };
  'theme.changed': { mode: 'light' | 'dark' | 'system' };
  'app.backgrounded': { at: number };
  'app.foregrounded': { at: number };
};

export type OrbitEventName = keyof OrbitEventMap;

export type OrbitEvent<Name extends OrbitEventName = OrbitEventName> = {
  name: Name;
  payload: OrbitEventMap[Name];
  origin: string;
  timestamp: number;
};

export type OrbitEventHandler<Name extends OrbitEventName> = (
  event: OrbitEvent<Name>
) => void | Promise<void>;

type Subscription = {
  id: number;
  pluginId: string;
  event: OrbitEventName;
  handler: OrbitEventHandler<OrbitEventName>;
};

const SECRET_KEY_PATTERN =
  /(secret|token|password|passwd|api[-_]?key|authorization|credential|private[-_]?key)/i;

const MAX_DEPTH = 8;
const MAX_DISPATCHES = 200;
const MAX_STRING = 2_000;
const MAX_LISTENERS_PER_PLUGIN = 50;

/**
 * Recursively removes obvious secrets and bounds payload size. Event payloads
 * are application data, never a transport for keys or tokens.
 */
export function sanitizeEventPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[depth-limited]';
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeEventPayload(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        output[key] = '[redacted]';
        continue;
      }

      output[key] = sanitizeEventPayload(entry, depth + 1);
    }

    return output;
  }

  return '[unsupported]';
}

export class PluginEventBus {
  private subscriptions = new Map<number, Subscription>();
  private nextId = 1;
  private depth = 0;
  private dispatchesInChain = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly onHandlerError?: (error: unknown, event: OrbitEventName) => void
  ) {}

  subscribe<Name extends OrbitEventName>(
    pluginId: string,
    event: Name,
    handler: OrbitEventHandler<Name>
  ): () => void {
    const forPlugin = this.listenerCount(pluginId);

    if (forPlugin >= MAX_LISTENERS_PER_PLUGIN) {
      throw new Error(
        `Plugin "${pluginId}" has reached the ${MAX_LISTENERS_PER_PLUGIN}-listener limit.`
      );
    }

    const id = this.nextId;
    this.nextId += 1;
    this.subscriptions.set(id, {
      id,
      pluginId,
      event,
      handler: handler as OrbitEventHandler<OrbitEventName>,
    });

    return () => {
      this.subscriptions.delete(id);
    };
  }

  emit<Name extends OrbitEventName>(
    name: Name,
    payload: OrbitEventMap[Name],
    origin = 'system'
  ): OrbitEvent<Name> {
    const event: OrbitEvent<Name> = {
      name,
      payload: sanitizeEventPayload(payload) as OrbitEventMap[Name],
      origin,
      timestamp: this.now(),
    };

    if (this.depth >= MAX_DEPTH || this.dispatchesInChain >= MAX_DISPATCHES) {
      this.onHandlerError?.(
        new Error(`Event "${name}" was dropped by the recursion guard.`),
        name
      );
      return event;
    }

    this.depth += 1;
    this.dispatchesInChain += 1;

    try {
      for (const subscription of Array.from(this.subscriptions.values())) {
        if (subscription.event !== name) {
          continue;
        }

        try {
          const result = subscription.handler(event as OrbitEvent<OrbitEventName>);

          if (result && typeof (result as Promise<void>).catch === 'function') {
            void (result as Promise<void>).catch((error: unknown) => {
              this.onHandlerError?.(error, name);
            });
          }
        } catch (error) {
          this.onHandlerError?.(error, name);
        }
      }
    } finally {
      this.depth -= 1;

      if (this.depth === 0) {
        this.dispatchesInChain = 0;
      }
    }

    return event;
  }

  clearPlugin(pluginId: string): void {
    for (const [id, subscription] of this.subscriptions) {
      if (subscription.pluginId === pluginId) {
        this.subscriptions.delete(id);
      }
    }
  }

  clear(): void {
    this.subscriptions.clear();
    this.depth = 0;
    this.dispatchesInChain = 0;
  }

  listenerCount(pluginId?: string): number {
    if (!pluginId) {
      return this.subscriptions.size;
    }

    let count = 0;

    for (const subscription of this.subscriptions.values()) {
      if (subscription.pluginId === pluginId) {
        count += 1;
      }
    }

    return count;
  }

  listenersFor(event: OrbitEventName): string[] {
    return Array.from(this.subscriptions.values())
      .filter((subscription) => subscription.event === event)
      .map((subscription) => subscription.pluginId);
  }
}
