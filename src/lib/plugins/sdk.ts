import type { PluginEventBus, OrbitEventHandler, OrbitEventMap, OrbitEventName } from './events';
import type { PluginPermissionManager } from './permissions';
import type { PluginKeyValueStorage } from './storage';
import type {
  PluginImplementation,
  PluginManifest,
  PluginPermission,
  PluginRecord,
  PluginToolDefinition,
} from './types';

export type PluginLogger = {
  debug: (message: string, detail?: unknown) => void;
  info: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  error: (message: string, detail?: unknown) => void;
};

export type PluginCredentialStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export type PluginNotificationInput = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PluginNetworkResponse = {
  ok: boolean;
  status: number;
  text: string;
  headers: Record<string, string>;
};

/**
 * The subset of the registry exposed to a plugin. Deliberately narrow: no
 * database, no Cordis context, no application state, no credential manager.
 */
export type PluginSdkRegistry = {
  getManifest: (pluginId: string) => PluginManifest;
  getRecord: (pluginId: string) => PluginRecord | null;
  hasPermission: (pluginId: string, permission: PluginPermission) => boolean;
  approvePermissions: (
    pluginId: string,
    permissions: PluginPermission[],
    reason: string
  ) => Promise<void>;
  registerTool: (
    pluginId: string,
    definition: PluginToolDefinition
  ) => Promise<() => void>;
  getSettings: (pluginId: string) => Promise<Record<string, unknown>>;
  setSetting: (pluginId: string, key: string, value: unknown) => Promise<void>;
  deleteSetting: (pluginId: string, key: string) => Promise<void>;
};

export type CreatePluginSdkInput = {
  pluginId: string;
  manifest: PluginManifest;
  registry: PluginSdkRegistry;
  permissions: PluginPermissionManager;
  events: PluginEventBus;
  storage: PluginKeyValueStorage;
  requestApproval: (
    permissions: PluginPermission[],
    reason: string
  ) => Promise<boolean>;
  notifications?: {
    send: (input: PluginNotificationInput) => Promise<void>;
  };
  credentials?: PluginCredentialStore;
  logger?: (message: string, detail?: unknown) => void;
};

export type OrbitPluginSdk = {
  readonly pluginId: string;
  readonly version: string;
  readonly manifest: PluginManifest;
  permissions: {
    list: () => PluginPermission[];
    has: (permission: PluginPermission) => boolean;
    request: (
      permissions: PluginPermission[],
      reason: string
    ) => Promise<boolean>;
  };
  events: {
    subscribe: <Name extends OrbitEventName>(
      event: Name,
      handler: OrbitEventHandler<Name>
    ) => () => void;
    emit: <Name extends OrbitEventName>(
      event: Name,
      payload: OrbitEventMap[Name]
    ) => void;
  };
  storage: {
    get: (key: string) => Promise<unknown | null>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    list: () => Promise<{ key: string; bytes: number; updatedAt: number }[]>;
    usage: () => Promise<{ bytes: number; limit: number }>;
  };
  settings: {
    all: () => Promise<Record<string, unknown>>;
    get: (key: string) => Promise<unknown | null>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  navigation: {
    entries: () => PluginManifest['navigationEntries'];
  };
  tools: {
    register: (definition: PluginToolDefinition) => Promise<() => void>;
  };
  ai: {
    registerTool: (definition: PluginToolDefinition) => Promise<() => void>;
  };
  notifications: {
    send: (input: PluginNotificationInput) => Promise<void>;
  };
  credentials: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  network: {
    fetch: (
      url: string,
      init?: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        headers?: Record<string, string>;
        body?: string;
      }
    ) => Promise<PluginNetworkResponse>;
  };
  diagnostics: {
    status: () => string;
    health: () => PluginRecord['health'] | null;
    log: PluginLogger['info'];
  };
  logger: PluginLogger;
  dispose: () => void;
};

const NETWORK_TIMEOUT_MS = 20_000;
const MAX_NETWORK_RESPONSE = 512 * 1024;

function assertPermissionInManifest(
  manifest: PluginManifest,
  permission: PluginPermission
): void {
  if (!manifest.permissions.includes(permission)) {
    throw new Error(
      `Plugin "${manifest.pluginId}" did not declare the "${permission}" permission.`
    );
  }
}

function redact(message: string): string {
  return message
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:token|key|secret|password)\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

export function createPluginSdk(input: CreatePluginSdkInput): OrbitPluginSdk {
  const {
    pluginId,
    manifest,
    registry,
    permissions,
    events,
    storage,
    requestApproval,
  } = input;
  const disposers: (() => void)[] = [];

  const log =
    (level: keyof PluginLogger) =>
    (message: string, detail?: unknown): void => {
      const text = `[plugin:${pluginId}] ${redact(message)}`;
      const logger = input.logger;

      if (logger) {
        logger(text, detail);
        return;
      }

      if (level === 'error') {
        console.warn(text, detail);
      } else if (level === 'warn') {
        console.warn(text, detail);
      } else {
        console.log(text, detail);
      }
    };

  const logger: PluginLogger = {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };

  const assertPermission = (permission: PluginPermission): void => {
    assertPermissionInManifest(manifest, permission);
    permissions.assert(pluginId, permission);
  };

  const sdk: OrbitPluginSdk = {
    pluginId,
    version: manifest.version,
    manifest,
    permissions: {
      list: () => permissions.activeGrants(pluginId),
      has: (permission) => permissions.has(pluginId, permission),
      async request(requested, reason) {
        if (requested.length === 0) {
          return true;
        }

        for (const permission of requested) {
          assertPermissionInManifest(manifest, permission);
        }

        const approved = await requestApproval(requested, reason);

        if (!approved) {
          return false;
        }

        await registry.approvePermissions(
          pluginId,
          requested,
          reason || 'Plugin requested permissions at runtime.'
        );

        return true;
      },
    },
    events: {
      subscribe(event, handler) {
        if (!manifest.events.listens.includes(event)) {
          throw new Error(
            `Plugin "${pluginId}" did not declare events.listens entry "${event}".`
          );
        }

        const unsubscribe = events.subscribe(pluginId, event, handler);
        disposers.push(unsubscribe);
        return unsubscribe;
      },
      emit(event, payload) {
        if (!manifest.events.emits.includes(event)) {
          throw new Error(
            `Plugin "${pluginId}" did not declare events.emits entry "${event}".`
          );
        }

        events.emit(event, payload, pluginId);
      },
    },
    storage: {
      async get(key) {
        assertPermission('storage.read');
        return storage.get(pluginId, key);
      },
      async set(key, value) {
        assertPermission('storage.write');
        await storage.set(pluginId, key, value);
      },
      async delete(key) {
        assertPermission('storage.write');
        await storage.delete(pluginId, key);
      },
      async list() {
        assertPermission('storage.read');
        return storage.list(pluginId);
      },
      async usage() {
        assertPermission('storage.read');
        return storage.usage(pluginId);
      },
    },
    settings: {
      all: () => registry.getSettings(pluginId),
      async get(key) {
        const all = await registry.getSettings(pluginId);
        return all[key] ?? null;
      },
      async set(key, value) {
        assertPermission('storage.write');
        await registry.setSetting(pluginId, key, value);
      },
      async delete(key) {
        assertPermission('storage.write');
        await registry.deleteSetting(pluginId, key);
      },
    },
    navigation: {
      entries: () => manifest.navigationEntries.map((entry) => ({ ...entry })),
    },
    tools: {
      register(definition) {
        return registry.registerTool(pluginId, definition);
      },
    },
    ai: {
      registerTool(definition) {
        return registry.registerTool(pluginId, definition);
      },
    },
    notifications: {
      async send(notification) {
        assertPermission('notifications.send');

        if (!input.notifications) {
          throw new Error('Notifications are unavailable in this runtime.');
        }

        await input.notifications.send({
          title: notification.title,
          body: notification.body,
          data: notification.data,
        });
      },
    },
    credentials: {
      async get(key) {
        assertPermission('credentials.request');

        if (!input.credentials) {
          throw new Error('Secure credentials are unavailable in this runtime.');
        }

        return input.credentials.get(key);
      },
      async set(key, value) {
        assertPermission('credentials.request');

        if (!input.credentials) {
          throw new Error('Secure credentials are unavailable in this runtime.');
        }

        await input.credentials.set(key, value);
      },
      async delete(key) {
        assertPermission('credentials.request');

        if (!input.credentials) {
          throw new Error('Secure credentials are unavailable in this runtime.');
        }

        await input.credentials.delete(key);
      },
    },
    network: {
      async fetch(url, init) {
        assertPermission('network.access');

        let parsed: URL;

        try {
          parsed = new URL(url);
        } catch {
          throw new Error('Plugin network requests need an absolute URL.');
        }

        if (parsed.protocol !== 'https:') {
          throw new Error('Plugin network requests must use HTTPS.');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

        try {
          const response = await fetch(url, {
            method: init?.method ?? 'GET',
            headers: init?.headers,
            body: init?.body,
            signal: controller.signal,
          });
          const text = (await response.text()).slice(0, MAX_NETWORK_RESPONSE);
          const headers: Record<string, string> = {};

          response.headers.forEach((value, key) => {
            headers[key] = value;
          });

          return { ok: response.ok, status: response.status, text, headers };
        } finally {
          clearTimeout(timer);
        }
      },
    },
    diagnostics: {
      status: () => registry.getRecord(pluginId)?.status ?? 'unknown',
      health: () => registry.getRecord(pluginId)?.health ?? null,
      log: logger.info,
    },
    logger,
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch {
          // Disposal must never throw during plugin shutdown.
        }
      }

      events.clearPlugin(pluginId);
    },
  };

  return sdk;
}

/**
 * Author-facing helper. Built-in plugins use this to keep the manifest and
 * implementation together; third-party plugins are declarative and do not
 * provide an implementation.
 */
export function definePlugin(
  manifest: PluginManifest,
  implementation: PluginImplementation
): { manifest: PluginManifest; implementation: PluginImplementation } {
  return { manifest, implementation };
}

export type { OrbitEventName as PluginEventName };
