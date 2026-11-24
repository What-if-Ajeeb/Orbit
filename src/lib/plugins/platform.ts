import type { SQLiteDatabase } from 'expo-sqlite';

import { agentToolRegistry } from '@/lib/ai/tool-registry';
import {
  refreshMcpTools,
  setMcpToolGate,
  type McpSyncResult,
} from '@/lib/mcp/registry';
import { loadMcpServers, type McpServerConfig } from '@/lib/mcp/settings';
import { PluginStore, type PluginType } from '@/lib/plugin-store';

import { pluginApprovalService } from './approvals';
import {
  CORE_PLUGIN_IDS,
  DIAGNOSTICS_MANIFEST,
  DIAGNOSTICS_PLUGIN_ID,
  registerBuiltinImplementations,
} from './builtins';
import { registerBundledCatalog } from './catalog';
import { PluginEventBus } from './events';
import { syncMcpPluginRecords, mcpPluginAllowsTool, type McpPluginSyncResult } from './mcp-bridge';
import { PluginPermissionManager } from './permissions';
import { SqlitePluginPersistence, type PluginPersistence } from './persistence';
import { PluginRegistry } from './registry';
import { PluginKeyValueStorage } from './storage';
import type {
  PluginManifest,
  PluginPlatform as PluginPlatformName,
  PluginRuntimeStats,
  PluginSummary,
  PluginTrustLevel,
} from './types';
import {
  createSandboxToolExecutor,
  type PluginToolHost,
  type SandboxToolExecutor,
} from './tools';

const APP_VERSION = '1.10.6';
const LEGACY_MIGRATION_KEY = 'legacy.plugins.migrated.v1';
const DIAGNOSTICS_KEY = 'builtin.diagnostics.installed.v1';

export type PluginNavigationContribution = ReturnType<
  PluginRegistry['getNavigationEntries']
>[number];
export type PluginWidgetContribution = ReturnType<
  PluginRegistry['getWidgets']
>[number];
export type PluginSettingsContribution = ReturnType<
  PluginRegistry['getSettingsSections']
>[number];

const toolHost: PluginToolHost = {
  register(tool) {
    agentToolRegistry.register(tool);
  },
  unregister(name) {
    return agentToolRegistry.unregister(name);
  },
  has(name) {
    return agentToolRegistry.get(name) !== null;
  },
};

export type PluginPlatformSnapshot = {
  version: number;
  ready: boolean;
  error: string | null;
  summaries: PluginSummary[];
  stats: PluginRuntimeStats;
  navigation: PluginNavigationContribution[];
  widgets: PluginWidgetContribution[];
  settingsSections: PluginSettingsContribution[];
  corePluginIds: string[];
};

export type PluginPlatformOptions = {
  db: SQLiteDatabase;
  appVersion?: string;
  platform: PluginPlatformName;
  persistence?: PluginPersistence;
  requestPermissionApproval?: (input: {
    pluginId: string;
    pluginName: string;
    trustLevel: PluginTrustLevel;
    permissions: import('./types').PluginPermission[];
    reason: string;
  }) => Promise<boolean>;
  confirmSensitiveTool?: (input: {
    pluginId: string;
    pluginName: string;
    toolName: string;
  }) => Promise<boolean>;
  sandboxExecutor?: SandboxToolExecutor;
  logger?: (message: string, detail?: unknown) => void;
};

/**
 * Composition root for the ORBIT plugin platform.
 *
 * It owns the only permission manager, event bus, registry and persistence
 * instance in the app. The five Cordis spine plugins keep running under the
 * harness; they are adopted into this registry for visibility and are never
 * mounted or executed a second time.
 */
export class PluginPlatformRuntime {
  readonly persistence: PluginPersistence;
  readonly permissions: PluginPermissionManager;
  readonly events: PluginEventBus;
  readonly registry: PluginRegistry;
  readonly storage: PluginKeyValueStorage;
  readonly appVersion: string;
  readonly platform: PluginPlatformName;

  private initializePromise: Promise<void> | null = null;
  private ready = false;
  private error: string | null = null;
  private bootstrapMs: number | null = null;
  private snapshot: PluginPlatformSnapshot | null = null;
  private snapshotVersion = 0;
  private readonly listeners = new Set<() => void>();
  private readonly db: SQLiteDatabase;
  private readonly logger: (message: string, detail?: unknown) => void;

  constructor(options: PluginPlatformOptions) {
    this.db = options.db;
    this.platform = options.platform;
    this.appVersion = options.appVersion ?? APP_VERSION;
    this.logger =
      options.logger ??
      ((message, detail) => {
        console.warn(message, detail);
      });
    this.persistence =
      options.persistence ?? new SqlitePluginPersistence(options.db);
    this.permissions = new PluginPermissionManager(this.persistence);
    this.events = new PluginEventBus(Date.now, (error, event) => {
      this.logger(`Plugin event handler failed for ${event}.`, error);
    });
    this.storage = new PluginKeyValueStorage(this.persistence);
    this.registry = new PluginRegistry({
      appVersion: this.appVersion,
      platform: this.platform,
      persistence: this.persistence,
      permissions: this.permissions,
      events: this.events,
      toolHost,
      storage: this.storage,
      logger: this.logger,
      requestPermissionApproval:
        options.requestPermissionApproval ??
        (async (input) =>
          pluginApprovalService.requestPermissions({
            pluginId: input.pluginId,
            pluginName: input.pluginName,
            trustLevel: input.trustLevel,
            permissions: input.permissions,
            reason: input.reason,
          })),
      confirmSensitiveTool:
        options.confirmSensitiveTool ??
        (async (input) =>
          pluginApprovalService.requestTool({
            pluginId: input.pluginId,
            pluginName: input.pluginName,
            trustLevel:
              this.registry.getRecord(input.pluginId)?.trustLevel ?? 'untrusted',
            toolName: input.toolName,
            permissions: ['ai.invoke'],
            reason: `Run the "${input.toolName}" tool?`,
          })),
      sandboxExecutor: options.sandboxExecutor ?? createSandboxToolExecutor(),
    });

    this.registry.subscribe(() => {
      this.snapshot = null;
      this.snapshotVersion += 1;
      this.emitChange();
    });

    // Install the gate before bootstrap finishes. Until MCP records are synced,
    // the registry has no matching record and every tool call is denied.
    setMcpToolGate((serverId) =>
      mcpPluginAllowsTool(this.registry, this.permissions, serverId)
    );
  }

  private emitChange(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (error) {
        this.logger('Plugin platform listener failed.', error);
      }
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PluginPlatformSnapshot => {
    if (!this.snapshot) {
      this.snapshot = {
        version: this.snapshotVersion,
        ready: this.ready,
        error: this.error,
        summaries: this.registry.getSummaries(),
        stats: this.registry.getRuntimeStats(
          this.bootstrapMs,
          this.error
        ),
        navigation: this.registry.getNavigationEntries(),
        widgets: this.registry.getWidgets(),
        settingsSections: this.registry.getSettingsSections(),
        corePluginIds: [...CORE_PLUGIN_IDS],
      };
    }

    return this.snapshot;
  };

  isReady(): boolean {
    return this.ready;
  }

  getError(): string | null {
    return this.error;
  }

  async initialize(): Promise<void> {
    this.initializePromise ??= this.bootstrap();
    return this.initializePromise;
  }

  private async bootstrap(): Promise<void> {
    const started = Date.now();

    try {
      await this.permissions.initialize();

      const saved = await this.persistence.loadPlugins();
      const resumable = await this.registry.restore(saved);

      registerBundledCatalog(this.registry);
      registerBuiltinImplementations(this.registry);

      await this.adoptCorePlugins();
      await this.migrateLegacyPlugins();
      await this.ensureDiagnostics();

      const servers = await loadMcpServers();
      await this.syncMcpServers(servers);

      await this.resumePlugins(resumable);

      this.ready = true;
      this.bootstrapMs = Date.now() - started;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.bootstrapMs = Date.now() - started;
      this.logger('Plugin platform failed to start.', error);
      throw error;
    } finally {
      this.snapshot = null;
      this.snapshotVersion += 1;
      this.emitChange();
    }
  }

  private async adoptCorePlugins(): Promise<void> {
    for (const manifest of this.registry
      .getCatalogEntries()
      .filter((entry) => CORE_PLUGIN_IDS.includes(entry.manifest.pluginId))
      .map((entry) => entry.manifest)) {
      try {
        await this.registry.adopt(manifest, {
          trustLevel: 'official',
          source: 'builtin',
          status: 'running',
          enabled: true,
          detail: 'Core Cordis service observed by the plugin platform.',
        });
      } catch (error) {
        this.logger(`Could not adopt core plugin ${manifest.pluginId}.`, error);
      }
    }
  }

  private async ensureDiagnostics(): Promise<void> {
    const marker = await this.persistence.getMeta(DIAGNOSTICS_KEY);

    if (marker) {
      return;
    }

    try {
      const existing = this.registry.getRecord(DIAGNOSTICS_PLUGIN_ID);

      if (!existing || existing.status === 'available') {
        if (existing?.status === 'available') {
          await this.registry.install(DIAGNOSTICS_PLUGIN_ID);
        }
      }

      const record = this.registry.getRecord(DIAGNOSTICS_PLUGIN_ID);

      if (record && ['installed', 'disabled'].includes(record.status)) {
        await this.permissions.grant(
          DIAGNOSTICS_PLUGIN_ID,
          DIAGNOSTICS_MANIFEST.permissions,
          'core',
          'Built-in plugin auto-granted its UI contribution permission.'
        );
        await this.registry.enable(DIAGNOSTICS_PLUGIN_ID);
      }

      await this.persistence.setMeta(DIAGNOSTICS_KEY, new Date().toISOString());
    } catch (error) {
      this.logger('Could not install the built-in diagnostics plugin.', error);
    }
  }

  private async resumePlugins(pluginIds: string[]): Promise<void> {
    if (pluginIds.length === 0) {
      return;
    }

    let order: string[];

    try {
      order = this.registry.getStartupOrder();
    } catch {
      order = [...pluginIds].sort();
    }

    for (const pluginId of order) {
      if (!pluginIds.includes(pluginId)) {
        continue;
      }

      const record = this.registry.getRecord(pluginId);

      if (!record || !['installed', 'disabled'].includes(record.status)) {
        continue;
      }

      try {
        await this.registry.enable(pluginId);
      } catch (error) {
        this.logger(`Could not resume plugin ${pluginId}.`, error);
      }
    }
  }

  private legacyManifest(plugin: {
    id: number;
    name: string;
    type: PluginType;
    createdAt: number;
  }): PluginManifest {
    const category =
      plugin.type === 'tool'
        ? 'tool'
        : plugin.type === 'overlay'
          ? 'ui'
          : plugin.type === 'provider'
            ? 'provider'
            : 'storage';

    return {
      manifestVersion: 1,
      pluginId: `legacy.local.plugin-${plugin.id}`,
      name: plugin.name.slice(0, 120) || `Legacy plugin ${plugin.id}`,
      version: '0.0.0',
      description:
        'Imported from the legacy plugin store. Its executable code was not migrated and will never run in ORBIT 2.0.',
      author: { name: 'Legacy device plugin' },
      publisher: {
        id: 'local.legacy',
        name: 'Imported from this device',
        verified: false,
      },
      category,
      icon: 'time-outline',
      minimumOrbitVersion: '1.0.0',
      platformSupport: ['android', 'ios', 'web'],
      entryPoint: { kind: 'declarative', screen: 'plugin-home' },
      permissions: [],
      capabilities: [],
      dependencies: [],
      optionalDependencies: [],
      routes: [],
      navigationEntries: [],
      dashboardWidgets: [],
      settingsSections: [],
      settingsSchema: [],
      toolbarActions: [],
      contextActions: [],
      mcpTools: [],
      events: { emits: [], listens: [] },
      lifecycleHooks: [],
      dataSchemaVersion: 1,
      updatePolicy: 'manual',
    };
  }

  /**
   * Imports legacy `plugins` rows as disabled, untrusted records. The original
   * rows and any `overlays` rows stay untouched so an older ORBIT build can
   * still read its data; no legacy code is loaded or evaluated.
   */
  private async migrateLegacyPlugins(): Promise<void> {
    const marker = await this.persistence.getMeta(LEGACY_MIGRATION_KEY);

    if (marker) {
      return;
    }

    try {
      const legacy = await new PluginStore(this.db).listPlugins();

      for (const plugin of legacy) {
        const manifest = this.legacyManifest(plugin);

        if (this.registry.getRecord(manifest.pluginId)) {
          continue;
        }

        await this.registry.adopt(manifest, {
          trustLevel: 'untrusted',
          source: 'legacy',
          status: 'disabled',
          enabled: false,
          legacy: true,
          detail:
            'Legacy plugin record imported for audit. Executable code is not migrated.',
        });
      }

      await this.persistence.setMeta(
        LEGACY_MIGRATION_KEY,
        String(legacy.length)
      );
    } catch (error) {
      this.logger('Legacy plugin migration failed.', error);
      throw error;
    }
  }

  async syncMcpServers(
    servers?: McpServerConfig[],
    options: { refreshTools?: boolean } = {}
  ): Promise<{ plugins: McpPluginSyncResult; tools: McpSyncResult | null }> {
    const list = servers ?? (await loadMcpServers());
    const plugins = await syncMcpPluginRecords({
      registry: this.registry,
      permissions: this.permissions,
      servers: list,
    });

    let tools: McpSyncResult | null = null;

    if (options.refreshTools) {
      try {
        tools = await refreshMcpTools(list);
      } catch (error) {
        this.logger('MCP tool refresh failed after a settings change.', error);
      }
    }

    this.snapshot = null;
    this.snapshotVersion += 1;
    this.emitChange();
    return { plugins, tools };
  }

  isCorePlugin(pluginId: string): boolean {
    return CORE_PLUGIN_IDS.includes(pluginId);
  }

  isMcpPlugin(pluginId: string): boolean {
    return this.registry.getRecord(pluginId)?.manifest.entryPoint.kind === 'mcp';
  }
}

let platformSingleton: PluginPlatformRuntime | null = null;

export function getPluginPlatform(): PluginPlatformRuntime | null {
  return platformSingleton;
}

/**
 * Returns the process-wide platform, creating it on first call. Callers pass
 * the current SQLite handle; a different handle replaces a disposed instance
 * (this happens in development Fast Refresh).
 */
export function initializePluginPlatform(
  options: PluginPlatformOptions
): PluginPlatformRuntime {
  if (!platformSingleton) {
    platformSingleton = new PluginPlatformRuntime(options);
    return platformSingleton;
  }

  return platformSingleton;
}

export function disposePluginPlatform(): void {
  platformSingleton = null;
  setMcpToolGate(null);
}
