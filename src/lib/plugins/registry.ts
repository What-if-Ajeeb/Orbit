import type { AgentTool } from '@/lib/ai/tool-registry';

import { errorMessage, TimeoutError, withTimeout } from './async';
import type { OrbitEventMap, OrbitEventName, PluginEventBus } from './events';
import {
  isEntryPointAllowed,
  manifestPlatformSupported,
  PLUGIN_ID_PATTERN,
  validateManifest,
} from './manifest';
import {
  MissingPluginPermissionsError,
  PluginPermissionManager,
} from './permissions';
import type { PluginPersistence } from './persistence';
import { isValidSemver, satisfiesRange } from './semver';
import { createPluginSdk, type OrbitPluginSdk } from './sdk';
import {
  isSecretSettingKey,
  validateSettingValue,
  withSettingDefaults,
  PluginKeyValueStorage,
} from './storage';
import {
  assertToolCanRegister,
  buildPluginAgentTool,
  isValidPluginToolName,
  namespacedPluginToolName,
  pluginToolNamespace,
  type PluginToolHost,
} from './tools';
import {
  PLUGIN_PERMISSIONS,
  type InstallHistoryRecord,
  type PermissionAuditRecord,
  type PluginCatalogEntry,
  type PluginDependency,
  type PluginHealth,
  type PluginImplementation,
  type PluginManifest,
  type PluginPermission,
  type PluginPlatform,
  type PluginRecord,
  type PluginRuntimeStats,
  type PluginSettingField,
  type PluginSource,
  type PluginStatus,
  type PluginSummary,
  type PluginToolDefinition,
  type PluginTrustLevel,
} from './types';

export const PLUGIN_STATE_TRANSITIONS: Record<PluginStatus, PluginStatus[]> = {
  discovered: ['available'],
  available: ['installing'],
  installing: ['installed', 'available', 'error'],
  installed: ['enabling', 'updating', 'uninstalling', 'disabled'],
  disabled: ['enabling', 'updating', 'uninstalling', 'error'],
  enabling: ['enabled', 'error'],
  enabled: ['starting', 'stopping', 'disabled', 'error'],
  starting: ['running', 'error'],
  running: ['stopping', 'updating', 'uninstalling', 'disabled', 'error'],
  stopping: ['disabled', 'error'],
  error: ['enabling', 'disabled', 'uninstalling', 'updating'],
  updating: ['installed', 'disabled', 'running', 'error'],
  uninstalling: ['available', 'error'],
};

const INSTALLED_STATUSES: PluginStatus[] = [
  'installed',
  'disabled',
  'enabling',
  'enabled',
  'starting',
  'running',
  'stopping',
  'error',
  'updating',
];

const ACTIVE_STATUSES: PluginStatus[] = ['enabled', 'starting', 'running'];

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;
const ERROR_HOOK_TIMEOUT_MS = 2_000;

export class PluginRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginRegistryError';
  }
}

export class DuplicatePluginError extends PluginRegistryError {
  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is already registered.`);
    this.name = 'DuplicatePluginError';
  }
}

export class PluginCompatibilityError extends PluginRegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'PluginCompatibilityError';
  }
}

export class DependencyResolutionError extends PluginRegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyResolutionError';
  }
}

export class PluginInUseError extends PluginRegistryError {
  constructor(pluginId: string, dependents: string[]) {
    super(
      `Plugin "${pluginId}" is required by: ${dependents.join(', ')}. Disable or uninstall those plugins first.`
    );
    this.name = 'PluginInUseError';
  }
}

export class PluginLifecycleError extends PluginRegistryError {
  constructor(
    public readonly pluginId: string,
    public readonly hook: string,
    message: string
  ) {
    super(message);
    this.name = 'PluginLifecycleError';
  }
}

export class PluginUpdatePermissionError extends PluginRegistryError {
  constructor(
    public readonly pluginId: string,
    public readonly addedPermissions: PluginPermission[]
  ) {
    super(
      `Plugin "${pluginId}" adds permissions that need approval: ${addedPermissions.join(', ')}.`
    );
    this.name = 'PluginUpdatePermissionError';
  }
}

export class PluginSettingError extends PluginRegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'PluginSettingError';
  }
}

type RegistryEntry = {
  record: PluginRecord;
  implementation?: PluginImplementation;
  sdk?: OrbitPluginSdk;
  initialized: boolean;
  toolUnregisters: Map<string, () => void>;
};

type CatalogItem = {
  manifest: PluginManifest;
  trustLevel: PluginTrustLevel;
  source: PluginSource;
  screenshots: string[];
  readme: string;
};

export type DiscoverOptions = {
  trustLevel: PluginTrustLevel;
  source: PluginSource;
};

export type PluginRegistryOptions = {
  appVersion: string;
  platform: PluginPlatform;
  persistence: PluginPersistence;
  permissions: PluginPermissionManager;
  events: PluginEventBus;
  toolHost?: PluginToolHost;
  storage?: PluginKeyValueStorage;
  now?: () => number;
  hookTimeoutMs?: number;
  requestPermissionApproval?: (input: {
    pluginId: string;
    pluginName: string;
    trustLevel: PluginTrustLevel;
    permissions: PluginPermission[];
    reason: string;
  }) => Promise<boolean>;
  confirmSensitiveTool?: (input: {
    pluginId: string;
    pluginName: string;
    toolName: string;
  }) => Promise<boolean>;
  logger?: (message: string, detail?: unknown) => void;
};

export type EnableOptions = {
  approvePermissions?: PluginPermission[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyHealth(): PluginHealth {
  return {
    status: 'unknown',
    failures: 0,
    lastError: null,
    lastCheckedAt: null,
  };
}

function hasUiContributions(manifest: PluginManifest): boolean {
  return (
    manifest.routes.length > 0 ||
    manifest.navigationEntries.length > 0 ||
    manifest.dashboardWidgets.length > 0 ||
    manifest.settingsSections.length > 0 ||
    manifest.toolbarActions.length > 0 ||
    manifest.contextActions.length > 0
  );
}

export class PluginRegistry {
  private entries = new Map<string, RegistryEntry>();
  private catalog = new Map<string, CatalogItem>();
  private implementations = new Map<string, PluginImplementation>();
  private listeners = new Set<() => void>();
  private installing = new Set<string>();
  private storage: PluginKeyValueStorage;
  private readonly now: () => number;
  private readonly hookTimeoutMs: number;

  constructor(private readonly options: PluginRegistryOptions) {
    this.now = options.now ?? (() => Date.now());
    this.hookTimeoutMs = options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
    this.storage =
      options.storage ??
      new PluginKeyValueStorage(options.persistence, undefined, this.now);
  }

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
      } catch (error) {
        this.log('Plugin registry listener failed.', error);
      }
    }
  }

  private log(message: string, detail?: unknown): void {
    if (this.options.logger) {
      this.options.logger(message, detail);
      return;
    }

    console.warn(message, detail);
  }

  private emitSafe<Name extends OrbitEventName>(
    name: Name,
    payload: OrbitEventMap[Name],
    origin = 'plugin-registry'
  ): void {
    try {
      this.options.events.emit(name, payload, origin);
    } catch (error) {
      this.log('Could not emit plugin event.', error);
    }
  }

  private transition(entry: RegistryEntry, next: PluginStatus): void {
    const current = entry.record.status;
    const allowed = PLUGIN_STATE_TRANSITIONS[current];

    if (!allowed.includes(next)) {
      throw new PluginRegistryError(
        `Invalid plugin state transition for "${entry.record.manifest.pluginId}": ${current} → ${next}.`
      );
    }

    entry.record.status = next;
    entry.record.updatedAt = this.now();
  }

  private forceStatus(entry: RegistryEntry, next: PluginStatus): void {
    entry.record.status = next;
    entry.record.updatedAt = this.now();
  }

  private refreshGrants(entry: RegistryEntry): void {
    entry.record.grantedPermissions = this.options.permissions.activeGrants(
      entry.record.manifest.pluginId
    );
  }

  private persisted(entry: RegistryEntry) {
    return {
      manifest: entry.record.manifest,
      manifestJson: JSON.stringify(entry.record.manifest),
      trustLevel: entry.record.trustLevel,
      source: entry.record.source,
      status: entry.record.status,
      enabled: entry.record.enabled,
      installedAt: entry.record.installedAt,
      updatedAt: entry.record.updatedAt,
      lastStartedAt: entry.record.lastStartedAt,
      lastStoppedAt: entry.record.lastStoppedAt,
      error: entry.record.error,
      health: entry.record.health,
      legacy: entry.record.legacy,
    };
  }

  private async persist(entry: RegistryEntry): Promise<void> {
    await this.options.persistence.upsertPlugin(this.persisted(entry));
  }

  private async history(input: {
    pluginId: string;
    action: InstallHistoryRecord['action'];
    fromVersion?: string | null;
    toVersion?: string | null;
    status: InstallHistoryRecord['status'];
    detail: string;
  }): Promise<void> {
    await this.options.persistence.appendInstallHistory({
      pluginId: input.pluginId,
      action: input.action,
      fromVersion: input.fromVersion ?? null,
      toVersion: input.toVersion ?? null,
      status: input.status,
      detail: input.detail,
    });
  }

  private checkCompatibility(manifest: PluginManifest): void {
    if (!manifestPlatformSupported(manifest, this.options.platform)) {
      throw new PluginCompatibilityError(
        `Plugin "${manifest.pluginId}" does not support the ${this.options.platform} platform.`
      );
    }

    if (
      !satisfiesRange(
        this.options.appVersion,
        `>=${manifest.minimumOrbitVersion}`
      )
    ) {
      throw new PluginCompatibilityError(
        `Plugin "${manifest.pluginId}" requires Orbit ${manifest.minimumOrbitVersion} or newer; this app is ${this.options.appVersion}.`
      );
    }
  }

  private validateContributionPolicy(manifest: PluginManifest): void {
    if (
      hasUiContributions(manifest) &&
      !manifest.permissions.includes('ui.contribute')
    ) {
      throw new PluginRegistryError(
        `Plugin "${manifest.pluginId}" declares UI contributions but does not request the "ui.contribute" permission.`
      );
    }

    if (
      (manifest.events.emits.length > 0 ||
        manifest.events.listens.length > 0) &&
      !manifest.capabilities.includes('events.subscribe') &&
      !manifest.capabilities.includes('events.publish')
    ) {
      throw new PluginRegistryError(
        `Plugin "${manifest.pluginId}" declares events without an events capability.`
      );
    }

    if (manifest.mcpTools.length > 0 && !manifest.permissions.includes('ai.invoke')) {
      throw new PluginRegistryError(
        `Plugin "${manifest.pluginId}" declares MCP tools but does not request "ai.invoke".`
      );
    }

    if (manifest.entryPoint.kind === 'declarative' && this.implementations.has(manifest.pluginId)) {
      throw new PluginRegistryError(
        `Declarative plugin "${manifest.pluginId}" cannot have executable implementation code.`
      );
    }
  }

  private assertNoDependencyCycle(
    startId: string,
    startManifest: PluginManifest
  ): void {
    const visit = (pluginId: string, trail: string[]): void => {
      if (trail.includes(pluginId)) {
        throw new DependencyResolutionError(
          `Dependency cycle detected: ${[...trail, pluginId].join(' → ')}.`
        );
      }

      const manifest =
        pluginId === startId
          ? startManifest
          : (this.entries.get(pluginId)?.record.manifest ??
            this.catalog.get(pluginId)?.manifest);

      if (!manifest) {
        return;
      }

      const dependencies = [
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
      ];

      for (const dependency of dependencies) {
        visit(dependency.pluginId, [...trail, pluginId]);
      }
    };

    visit(startId, []);
  }

  private resolveDependencyVersion(
    dependency: PluginDependency,
    optional: boolean
  ): PluginRecord | null {
    const entry = this.entries.get(dependency.pluginId);

    if (!entry) {
      if (optional) {
        return null;
      }

      const catalog = this.catalog.get(dependency.pluginId);

      if (catalog) {
        this.discover(catalog.manifest, {
          trustLevel: catalog.trustLevel,
          source: catalog.source,
        });
        return this.resolveDependencyVersion(dependency, optional);
      }

      throw new DependencyResolutionError(
        `Plugin "${dependency.pluginId}" (required version ${dependency.version}) is not installed.`
      );
    }

    if (!INSTALLED_STATUSES.includes(entry.record.status)) {
      throw new DependencyResolutionError(
        `Plugin "${dependency.pluginId}" is ${entry.record.status}, not installed.`
      );
    }

    if (!satisfiesRange(entry.record.manifest.version, dependency.version)) {
      throw new DependencyResolutionError(
        `Plugin "${dependency.pluginId}" is version ${entry.record.manifest.version}, but ${dependency.version} is required.`
      );
    }

    return entry.record;
  }

  private assertDependenciesReady(manifest: PluginManifest): void {
    for (const dependency of manifest.dependencies) {
      const record = this.resolveDependencyVersion(dependency, false);

      if (!record || !ACTIVE_STATUSES.includes(record.status)) {
        throw new DependencyResolutionError(
          `Enable dependency "${dependency.pluginId}" before enabling "${manifest.pluginId}".`
        );
      }
    }

    for (const dependency of manifest.optionalDependencies) {
      const entry = this.entries.get(dependency.pluginId);

      if (
        entry &&
        INSTALLED_STATUSES.includes(entry.record.status) &&
        !satisfiesRange(entry.record.manifest.version, dependency.version)
      ) {
        throw new DependencyResolutionError(
          `Optional plugin "${dependency.pluginId}" is version ${entry.record.manifest.version}, but ${dependency.version} is required when present.`
        );
      }
    }
  }

  /** Registers a validated manifest as available. Duplicate ids are rejected. */
  discover(rawManifest: unknown, options: DiscoverOptions): PluginManifest {
    const result = validateManifest(rawManifest);

    if (!result.ok) {
      throw new PluginRegistryError(
        `Invalid plugin manifest: ${result.errors.join('; ')}`
      );
    }

    const manifest = result.manifest;

    if (this.entries.has(manifest.pluginId)) {
      throw new DuplicatePluginError(manifest.pluginId);
    }

    if (!isEntryPointAllowed(manifest, options.trustLevel)) {
      throw new PluginRegistryError(
        `Plugin "${manifest.pluginId}" cannot use a reserved id or built-in entry point at trust level "${options.trustLevel}".`
      );
    }

    this.checkCompatibility(manifest);
    this.validateContributionPolicy(manifest);
    this.assertNoDependencyCycle(manifest.pluginId, manifest);

    const now = this.now();
    const record: PluginRecord = {
      manifest,
      trustLevel: options.trustLevel,
      source: options.source,
      status: 'discovered',
      enabled: false,
      grantedPermissions: [],
      installedAt: 0,
      updatedAt: now,
      lastStartedAt: null,
      lastStoppedAt: null,
      error: null,
      health: emptyHealth(),
      legacy: false,
    };
    const entry: RegistryEntry = {
      record,
      initialized: false,
      toolUnregisters: new Map(),
    };
    this.attachImplementation(entry);

    this.entries.set(manifest.pluginId, entry);
    this.transition(entry, 'available');
    this.emitSafe('plugin.discovered', {
      pluginId: manifest.pluginId,
      version: manifest.version,
    });
    this.notify();

    return manifest;
  }

  /**
   * Adds a manifest to the local catalog. If the plugin is already registered,
   * the installed manifest stays authoritative.
   */
  registerCatalog(
    rawManifest: unknown,
    options: {
      trustLevel: PluginTrustLevel;
      source: PluginSource;
      screenshots?: string[];
      readme?: string;
    }
  ): PluginManifest {
    const result = validateManifest(rawManifest);

    if (!result.ok) {
      throw new PluginRegistryError(
        `Invalid catalog manifest: ${result.errors.join('; ')}`
      );
    }

    const manifest = result.manifest;

    if (!this.entries.has(manifest.pluginId)) {
      this.discover(manifest, {
        trustLevel: options.trustLevel,
        source: options.source,
      });
    }

    this.catalog.set(manifest.pluginId, {
      manifest,
      trustLevel: options.trustLevel,
      source: options.source,
      screenshots: options.screenshots ?? [],
      readme: options.readme ?? '',
    });

    this.notify();
    return manifest;
  }

  registerImplementation(pluginId: string, implementation: PluginImplementation): void {
    const entry = this.entries.get(pluginId);

    if (entry && entry.record.manifest.entryPoint.kind !== 'builtin') {
      throw new PluginRegistryError(
        `Plugin "${pluginId}" is declarative and cannot have executable implementation code.`
      );
    }

    this.implementations.set(pluginId, implementation);

    if (entry) {
      entry.implementation = implementation;
    }
  }

  /** Attaches reviewed built-in code to an entry when one already exists. */
  private attachImplementation(entry: RegistryEntry): void {
    const implementation = this.implementations.get(
      entry.record.manifest.pluginId
    );

    if (implementation && entry.record.manifest.entryPoint.kind !== 'builtin') {
      throw new PluginRegistryError(
        `Plugin "${entry.record.manifest.pluginId}" is declarative and cannot have executable implementation code.`
      );
    }

    entry.implementation = implementation;
  }

  /**
   * Adopts a plugin that is already running outside the plugin lifecycle.
   *
   * This is used for the five Cordis spine plugins (mounted by the harness) and
   * for configured MCP servers (connected by the MCP registry). Adoption never
   * runs implementation code and never changes permissions; callers grant any
   * required permissions with an auditable source before calling this.
   */
  async adopt(
    rawManifest: unknown,
    options: {
      trustLevel: PluginTrustLevel;
      source: PluginSource;
      status?: Extract<PluginStatus, 'installed' | 'disabled' | 'running'>;
      enabled?: boolean;
      legacy?: boolean;
      detail?: string;
    }
  ): Promise<PluginRecord> {
    const result = validateManifest(rawManifest);

    if (!result.ok) {
      throw new PluginRegistryError(
        `Invalid adopted manifest: ${result.errors.join('; ')}`
      );
    }

    const manifest = result.manifest;

    if (!isEntryPointAllowed(manifest, options.trustLevel)) {
      throw new PluginRegistryError(
        `Plugin "${manifest.pluginId}" cannot be adopted at trust level "${options.trustLevel}".`
      );
    }

    this.checkCompatibility(manifest);
    this.validateContributionPolicy(manifest);

    const status = options.status ?? 'running';
    const enabled = options.enabled ?? status === 'running';
    const existing = this.entries.get(manifest.pluginId);
    const now = this.now();

    if (existing) {
      existing.record.manifest = manifest;
      existing.record.trustLevel = options.trustLevel;
      existing.record.source = options.source;
      existing.record.updatedAt = now;
      existing.record.grantedPermissions = this.options.permissions.activeGrants(
        manifest.pluginId
      );

      if (existing.record.status !== status) {
        this.forceStatus(existing, status);
      }

      existing.record.enabled = enabled;
      await this.persist(existing);
      this.notify();
      return existing.record;
    }

    const record: PluginRecord = {
      manifest,
      trustLevel: options.trustLevel,
      source: options.source,
      status,
      enabled,
      grantedPermissions: this.options.permissions.activeGrants(manifest.pluginId),
      installedAt: now,
      updatedAt: now,
      lastStartedAt: enabled ? now : null,
      lastStoppedAt: null,
      error: null,
      health: {
        status: status === 'running' ? 'healthy' : 'unknown',
        failures: 0,
        lastError: null,
        lastCheckedAt: now,
      },
      legacy: options.legacy === true,
    };

    const entry: RegistryEntry = {
      record,
      initialized: false,
      toolUnregisters: new Map(),
    };
    this.attachImplementation(entry);
    this.entries.set(manifest.pluginId, entry);
    await this.persist(entry);
    await this.history({
      pluginId: manifest.pluginId,
      action: 'install',
      toVersion: manifest.version,
      status: 'succeeded',
      detail:
        options.detail ??
        (options.source === 'builtin'
          ? 'Core plugin adopted from the Cordis spine.'
          : 'Integration plugin adopted from application settings.'),
    });
    this.notify();
    return record;
  }

  async restore(
    records: Awaited<ReturnType<PluginPersistence['loadPlugins']>>
  ): Promise<string[]> {
    const resumable: string[] = [];

    for (const saved of records) {
      const result = validateManifest(saved.manifest ?? saved.manifestJson);

      if (!result.ok) {
        await this.history({
          pluginId: saved.manifest?.pluginId ?? 'unknown.legacy.plugin',
          action: 'recovered',
          toVersion: saved.manifest?.version ?? null,
          status: 'failed',
          detail: `Stored manifest is invalid: ${result.errors.join('; ')}`,
        });
        continue;
      }

      const manifest = result.manifest;
      const interrupted = ['installing', 'updating', 'uninstalling'].includes(
        saved.status
      );
      const wasActive = ACTIVE_STATUSES.includes(saved.status);
      const status: PluginStatus = interrupted || wasActive ? 'disabled' : saved.status;

      if (saved.enabled && wasActive) {
        resumable.push(manifest.pluginId);
      }

      const record: PluginRecord = {
        manifest,
        trustLevel: saved.trustLevel,
        source: saved.source,
        status,
        enabled: false,
        grantedPermissions: this.options.permissions.activeGrants(manifest.pluginId),
        installedAt: saved.installedAt || this.now(),
        updatedAt: saved.updatedAt,
        lastStartedAt: saved.lastStartedAt,
        lastStoppedAt: saved.lastStoppedAt,
        error: interrupted
          ? 'Plugin was interrupted during an operation and was stopped safely.'
          : saved.error,
        health: saved.health ?? emptyHealth(),
        legacy: saved.legacy,
      };

      const entry: RegistryEntry = {
        record,
        initialized: false,
        toolUnregisters: new Map(),
      };
      this.attachImplementation(entry);
      this.entries.set(manifest.pluginId, entry);

      if (interrupted) {
        await this.history({
          pluginId: manifest.pluginId,
          action: 'recovered',
          toVersion: manifest.version,
          status: 'succeeded',
          detail: `Recovered from an interrupted ${saved.status} operation.`,
        });
      }
    }

    this.notify();
    return resumable;
  }

  async install(
    pluginId: string,
    options: { approvePermissions?: PluginPermission[] } = {}
  ): Promise<PluginRecord> {
    if (this.installing.has(pluginId)) {
      throw new DependencyResolutionError(
        `Plugin "${pluginId}" is already being installed as a dependency.`
      );
    }

    let entry = this.entries.get(pluginId);

    if (!entry && this.catalog.has(pluginId)) {
      const item = this.catalog.get(pluginId)!;
      this.discover(item.manifest, {
        trustLevel: item.trustLevel,
        source: item.source,
      });
      entry = this.entries.get(pluginId);
    }

    if (!entry) {
      throw new PluginRegistryError(`Plugin "${pluginId}" is not available.`);
    }

    if (INSTALLED_STATUSES.includes(entry.record.status)) {
      throw new PluginRegistryError(`Plugin "${pluginId}" is already installed.`);
    }

    if (!PLUGIN_ID_PATTERN.test(pluginId)) {
      throw new PluginRegistryError(`Invalid plugin id "${pluginId}".`);
    }

    const manifest = entry.record.manifest;
    this.checkCompatibility(manifest);
    this.assertNoDependencyCycle(pluginId, manifest);

    this.installing.add(pluginId);

    try {
      for (const dependency of manifest.dependencies) {
        const existing = this.entries.get(dependency.pluginId);

        if (!existing || !INSTALLED_STATUSES.includes(existing.record.status)) {
          if (this.catalog.has(dependency.pluginId)) {
            await this.install(dependency.pluginId);
          }
        }

        this.resolveDependencyVersion(dependency, false);
      }

      for (const dependency of manifest.optionalDependencies) {
        const existing = this.entries.get(dependency.pluginId);

        if (!existing && this.catalog.has(dependency.pluginId)) {
          // Optional dependencies are installed only when the user installs them.
          continue;
        }

        if (existing && INSTALLED_STATUSES.includes(existing.record.status)) {
          this.resolveDependencyVersion(dependency, true);
        }
      }

      this.transition(entry, 'installing');
      await this.history({
        pluginId,
        action: 'install',
        toVersion: manifest.version,
        status: 'started',
        detail: 'Installation started.',
      });

      try {
        await this.runHook(entry, 'onInstall');
      } catch (error) {
        this.forceStatus(entry, 'available');
        // runHook() already recorded the failure and incremented health.failures.
        entry.record.error = errorMessage(error);
        await this.history({
          pluginId,
          action: 'install',
          toVersion: manifest.version,
          status: 'failed',
          detail: errorMessage(error),
        });
        this.emitSafe('plugin.error', {
          pluginId,
          error: errorMessage(error),
          hook: 'onInstall',
        });
        this.notify();
        throw error;
      }

      const now = this.now();
      entry.record.installedAt = now;
      entry.record.updatedAt = now;
      entry.record.status = 'installed';
      entry.record.enabled = false;
      this.refreshGrants(entry);

      if (options.approvePermissions && options.approvePermissions.length > 0) {
        await this.options.permissions.approve(
          pluginId,
          manifest.permissions,
          options.approvePermissions
        );
        this.refreshGrants(entry);
      }

      await this.options.persistence.transaction(async () => {
        await this.persist(entry);
        await this.options.persistence.saveVersion(
          pluginId,
          manifest.version,
          JSON.stringify(manifest),
          entry.record.source
        );
        await this.options.persistence.saveDependencies(
          pluginId,
          manifest.dependencies
        );
        await this.history({
          pluginId,
          action: 'install',
          toVersion: manifest.version,
          status: 'succeeded',
          detail: 'Plugin installed.',
        });
      });

      this.emitSafe('plugin.installed', {
        pluginId,
        version: manifest.version,
        trustLevel: entry.record.trustLevel,
      });
      this.notify();
      return entry.record;
    } finally {
      this.installing.delete(pluginId);
    }
  }

  async enable(
    pluginId: string,
    options: EnableOptions = {}
  ): Promise<PluginRecord> {
    const entry = this.requireEntry(pluginId);

    if (entry.record.status === 'running') {
      return entry.record;
    }

    if (!INSTALLED_STATUSES.includes(entry.record.status)) {
      throw new PluginRegistryError(
        `Plugin "${pluginId}" must be installed before it can be enabled.`
      );
    }

    this.assertDependenciesReady(entry.record.manifest);

    const manifest = entry.record.manifest;
    const approved = options.approvePermissions ?? [];

    if (approved.length > 0) {
      const invalid = approved.filter(
        (permission) => !manifest.permissions.includes(permission)
      );

      if (invalid.length > 0) {
        throw new MissingPluginPermissionsError(pluginId, invalid);
      }

      await this.options.permissions.grant(
        pluginId,
        approved,
        'user',
        'User approved permissions while enabling the plugin.'
      );
      this.refreshGrants(entry);
    }

    const missing = this.options.permissions.missing(
      pluginId,
      manifest.permissions
    );

    if (missing.length > 0) {
      throw new MissingPluginPermissionsError(pluginId, missing);
    }

    this.transition(entry, 'enabling');

    try {
      await this.runHook(entry, 'onEnable');
      await this.initialize(entry);
      this.transition(entry, 'enabled');
      this.transition(entry, 'starting');
      await this.runHook(entry, 'onStart');

      if (entry.implementation) {
        if (manifest.entryPoint.kind !== 'builtin') {
          throw new PluginRegistryError(
            `Plugin "${pluginId}" has executable code but is not a built-in plugin.`
          );
        }

        await withTimeout(
          Promise.resolve(entry.implementation.activate?.(entry.sdk!)),
          this.hookTimeoutMs,
          `Plugin ${pluginId} activate`
        );
      }

      this.transition(entry, 'running');
      entry.record.enabled = true;
      entry.record.error = null;
      entry.record.lastStartedAt = this.now();
      entry.record.health = this.healthyHealth();
      this.refreshGrants(entry);
      await this.persist(entry);
      await this.history({
        pluginId,
        action: 'enable',
        toVersion: manifest.version,
        status: 'succeeded',
        detail: 'Plugin started.',
      });
      this.emitSafe('plugin.enabled', {
        pluginId,
        version: manifest.version,
      });
      this.notify();
      return entry.record;
    } catch (error) {
      await this.cleanupRuntime(entry);
      this.forceStatus(entry, 'error');
      entry.record.enabled = false;
      entry.record.error = errorMessage(error);
      entry.record.health = this.failedHealth(entry.record.health, entry.record.error);
      this.refreshGrants(entry);

      try {
        await this.persist(entry);
      } catch (persistError) {
        this.log(`Could not persist failed enable for ${pluginId}.`, persistError);
      }

      this.emitSafe('plugin.error', {
        pluginId,
        error: entry.record.error,
        hook: 'enable',
      });
      this.notify();
      throw error;
    }
  }

  async disable(pluginId: string, reason = 'Disabled by the user.'): Promise<PluginRecord> {
    const entry = this.requireEntry(pluginId);

    if (['available', 'installing', 'disabled', 'installed'].includes(entry.record.status)) {
      if (entry.record.status !== 'disabled') {
        this.forceStatus(entry, 'disabled');
        entry.record.enabled = false;
        await this.persist(entry);
        this.notify();
      }

      return entry.record;
    }

    if (entry.record.status === 'error' && !entry.record.enabled) {
      this.forceStatus(entry, 'disabled');
      await this.persist(entry);
      this.notify();
      return entry.record;
    }

    this.transition(entry, 'stopping');

    try {
      await this.cleanupRuntime(entry);
      await this.runHook(entry, 'onStop', true);
      await this.runHook(entry, 'onDisable', true);
      this.transition(entry, 'disabled');
      entry.record.enabled = false;
      entry.record.lastStoppedAt = this.now();
      this.refreshGrants(entry);
      await this.persist(entry);
      await this.history({
        pluginId,
        action: 'disable',
        toVersion: entry.record.manifest.version,
        status: 'succeeded',
        detail: reason,
      });
      this.emitSafe('plugin.disabled', {
        pluginId,
        version: entry.record.manifest.version,
        reason,
      });
      this.notify();
      return entry.record;
    } catch (error) {
      // A failed stop hook must not leave the plugin half-running.
      await this.cleanupRuntime(entry);
      this.forceStatus(entry, 'error');
      entry.record.enabled = false;
      entry.record.error = errorMessage(error);
      entry.record.health = this.failedHealth(entry.record.health, entry.record.error);
      await this.persist(entry);
      this.emitSafe('plugin.error', {
        pluginId,
        error: entry.record.error,
        hook: 'disable',
      });
      this.notify();
      throw error;
    }
  }

  async uninstall(
    pluginId: string,
    options: { deleteData?: boolean } = {}
  ): Promise<void> {
    const entry = this.requireEntry(pluginId);
    const dependents = this.findDependents(pluginId);

    if (dependents.length > 0) {
      throw new PluginInUseError(pluginId, dependents);
    }

    if (ACTIVE_STATUSES.includes(entry.record.status)) {
      await this.disable(pluginId, 'Plugin uninstall.');
    }

    this.transition(entry, 'uninstalling');

    try {
      await this.runHook(entry, 'onUninstall');
      await this.cleanupRuntime(entry);
      await this.options.permissions.revokeAll(
        pluginId,
        'Permissions removed because the plugin was uninstalled.'
      );
      this.options.events.clearPlugin(pluginId);

      if (options.deleteData) {
        await this.options.persistence.deleteAllSettings(pluginId);
        await this.options.persistence.clearKv(pluginId);
      }

      await this.options.persistence.deletePlugin(pluginId);
      await this.history({
        pluginId,
        action: 'uninstall',
        fromVersion: entry.record.manifest.version,
        status: 'succeeded',
        detail: options.deleteData
          ? 'Plugin uninstalled and plugin-owned data deleted.'
          : 'Plugin uninstalled; plugin-owned data retained.',
      });

      this.entries.delete(pluginId);
      this.emitSafe('plugin.uninstalled', {
        pluginId,
        version: entry.record.manifest.version,
        deletedData: options.deleteData === true,
      });

      const catalog = this.catalog.get(pluginId);

      if (catalog) {
        try {
          this.discover(catalog.manifest, {
            trustLevel: catalog.trustLevel,
            source: catalog.source,
          });
        } catch (error) {
          this.log(`Could not re-add ${pluginId} to available plugins.`, error);
        }
      }

      this.notify();
    } catch (error) {
      this.forceStatus(entry, 'error');
      entry.record.error = errorMessage(error);
      await this.persist(entry);
      await this.history({
        pluginId,
        action: 'uninstall',
        fromVersion: entry.record.manifest.version,
        status: 'failed',
        detail: errorMessage(error),
      });
      this.notify();
      throw error;
    }
  }

  async update(
    pluginId: string,
    rawManifest: unknown,
    options: { approveAddedPermissions?: PluginPermission[] } = {}
  ): Promise<PluginRecord> {
    const entry = this.requireEntry(pluginId);

    if (!INSTALLED_STATUSES.includes(entry.record.status)) {
      throw new PluginRegistryError(`Plugin "${pluginId}" is not installed.`);
    }

    const result = validateManifest(rawManifest);

    if (!result.ok) {
      throw new PluginRegistryError(
        `Invalid plugin update: ${result.errors.join('; ')}`
      );
    }

    const next = result.manifest;

    if (next.pluginId !== pluginId) {
      throw new PluginRegistryError(
        'An update cannot change the pluginId of an installed plugin.'
      );
    }

    if (!isValidSemver(next.version) || !isValidSemver(entry.record.manifest.version)) {
      throw new PluginRegistryError('Plugin versions must be valid semantic versions.');
    }

    if (satisfiesRange(next.version, `<=${entry.record.manifest.version}`)) {
      throw new PluginRegistryError(
        `Update version ${next.version} must be greater than installed version ${entry.record.manifest.version}.`
      );
    }

    if (!isEntryPointAllowed(next, entry.record.trustLevel)) {
      throw new PluginRegistryError(
        'An update cannot change the plugin to a reserved or built-in entry point.'
      );
    }

    this.checkCompatibility(next);
    this.validateContributionPolicy(next);
    this.assertNoDependencyCycle(pluginId, next);

    for (const dependency of next.dependencies) {
      this.resolveDependencyVersion(dependency, false);
    }

    const previousManifest = entry.record.manifest;
    const addedPermissions = next.permissions.filter(
      (permission) => !previousManifest.permissions.includes(permission)
    );
    const removedPermissions = previousManifest.permissions.filter(
      (permission) => !next.permissions.includes(permission)
    );
    const approved = new Set(options.approveAddedPermissions ?? []);
    const unapproved = addedPermissions.filter(
      (permission) => !approved.has(permission)
    );

    if (unapproved.length > 0) {
      throw new PluginUpdatePermissionError(pluginId, unapproved);
    }

    const wasRunning = entry.record.status === 'running';

    if (wasRunning) {
      await this.disable(pluginId, 'Plugin update.');
    }

    this.transition(entry, 'updating');

    const oldData = await this.snapshotData(pluginId);
    await this.options.persistence.saveBackup({
      pluginId,
      fromVersion: previousManifest.version,
      toVersion: next.version,
      data: JSON.stringify(oldData),
      createdAt: this.now(),
    });
    await this.history({
      pluginId,
      action: 'update',
      fromVersion: previousManifest.version,
      toVersion: next.version,
      status: 'started',
      detail: 'Update started.',
    });

    let permissionsApplied = false;

    try {
      await this.runHook(entry, 'onUpdate');
      entry.record.manifest = next;
      entry.record.updatedAt = this.now();
      entry.record.error = null;

      await this.options.permissions.grant(
        pluginId,
        addedPermissions,
        'user',
        'User approved new permissions for a plugin update.'
      );

      for (const permission of removedPermissions) {
        await this.options.permissions.revoke(
          pluginId,
          permission,
          'Permission removed by the plugin update.'
        );
      }

      permissionsApplied = true;
      this.refreshGrants(entry);
      this.forceStatus(entry, 'disabled');
      entry.record.enabled = false;

      await this.options.persistence.transaction(async () => {
        await this.persist(entry);
        await this.options.persistence.saveVersion(
          pluginId,
          next.version,
          JSON.stringify(next),
          entry.record.source
        );
        await this.options.persistence.saveDependencies(pluginId, next.dependencies);
        await this.history({
          pluginId,
          action: 'update',
          fromVersion: previousManifest.version,
          toVersion: next.version,
          status: 'succeeded',
          detail: 'Plugin updated.',
        });
      });

      this.emitSafe('plugin.updated', {
        pluginId,
        fromVersion: previousManifest.version,
        toVersion: next.version,
      });

      if (wasRunning) {
        return await this.enable(pluginId);
      }

      this.notify();
      return entry.record;
    } catch (error) {
      entry.record.manifest = previousManifest;
      entry.record.updatedAt = this.now();
      entry.record.status = 'disabled';
      entry.record.enabled = false;
      entry.record.error = errorMessage(error);
      entry.record.health = this.failedHealth(entry.record.health, entry.record.error);

      if (permissionsApplied) {
        await this.rollbackUpdatePermissions(
          pluginId,
          addedPermissions,
          removedPermissions
        );
      }

      this.refreshGrants(entry);
      await this.restoreData(pluginId, oldData);
      await this.persist(entry);
      await this.options.persistence.saveVersion(
        pluginId,
        previousManifest.version,
        JSON.stringify(previousManifest),
        entry.record.source
      );
      await this.history({
        pluginId,
        action: 'update',
        fromVersion: previousManifest.version,
        toVersion: next.version,
        status: 'failed',
        detail: errorMessage(error),
      });
      await this.history({
        pluginId,
        action: 'rollback',
        fromVersion: next.version,
        toVersion: previousManifest.version,
        status: 'succeeded',
        detail: 'Update failed; the previous manifest and data were restored.',
      });
      this.emitSafe('plugin.error', {
        pluginId,
        error: errorMessage(error),
        hook: 'update',
      });

      if (wasRunning) {
        try {
          const restarted = await this.enable(pluginId);
          this.notify();
          return restarted;
        } catch (restartError) {
          this.log(
            `Plugin ${pluginId} could not restart after rolling back an update.`,
            restartError
          );
        }
      }

      this.notify();
      throw error;
    }
  }

  private async rollbackUpdatePermissions(
    pluginId: string,
    addedPermissions: PluginPermission[],
    removedPermissions: PluginPermission[]
  ): Promise<void> {
    for (const permission of addedPermissions) {
      await this.options.permissions.revoke(
        pluginId,
        permission,
        'Permission removed because the update was rolled back.'
      );
    }

    if (removedPermissions.length > 0) {
      await this.options.permissions.grant(
        pluginId,
        removedPermissions,
        'user',
        'Permission restored because the update was rolled back.'
      );
    }
  }

  private async initialize(entry: RegistryEntry): Promise<void> {
    if (!entry.initialized) {
      entry.sdk = createPluginSdk({
        pluginId: entry.record.manifest.pluginId,
        manifest: entry.record.manifest,
        registry: this,
        permissions: this.options.permissions,
        events: this.options.events,
        storage: this.storage,
        requestApproval: async (permissions, reason) => {
          if (!this.options.requestPermissionApproval) {
            return false;
          }

          return this.options.requestPermissionApproval({
            pluginId: entry.record.manifest.pluginId,
            pluginName: entry.record.manifest.name,
            trustLevel: entry.record.trustLevel,
            permissions,
            reason,
          });
        },
        notifications: undefined,
        credentials: undefined,
        logger: (message, detail) => this.log(message, detail),
      });
      entry.initialized = true;
      await this.runHook(entry, 'onInitialize');
    } else {
      entry.sdk = createPluginSdk({
        pluginId: entry.record.manifest.pluginId,
        manifest: entry.record.manifest,
        registry: this,
        permissions: this.options.permissions,
        events: this.options.events,
        storage: this.storage,
        requestApproval: async (permissions, reason) => {
          if (!this.options.requestPermissionApproval) {
            return false;
          }

          return this.options.requestPermissionApproval({
            pluginId: entry.record.manifest.pluginId,
            pluginName: entry.record.manifest.name,
            trustLevel: entry.record.trustLevel,
            permissions,
            reason,
          });
        },
        notifications: undefined,
        credentials: undefined,
        logger: (message, detail) => this.log(message, detail),
      });
    }
  }

  private async cleanupRuntime(entry: RegistryEntry): Promise<void> {
    const pluginId = entry.record.manifest.pluginId;

    if (entry.implementation) {
      try {
        await withTimeout(
          Promise.resolve(
            entry.sdk
              ? entry.implementation.deactivate?.(entry.sdk)
              : undefined
          ),
          this.hookTimeoutMs,
          `Plugin ${pluginId} deactivate`
        );
      } catch (error) {
        this.log(`Plugin ${pluginId} deactivate failed.`, error);
      }
    }

    for (const [toolName, unregister] of entry.toolUnregisters) {
      try {
        unregister();
      } catch (error) {
        this.log(`Could not unregister plugin tool ${toolName}.`, error);
      }
    }

    entry.toolUnregisters.clear();

    try {
      entry.sdk?.dispose();
    } catch (error) {
      this.log(`Plugin ${pluginId} SDK disposal failed.`, error);
    }

    entry.sdk = undefined;
    this.options.events.clearPlugin(pluginId);
  }

  private async runHook(
    entry: RegistryEntry,
    hook: keyof NonNullable<PluginImplementation['hooks']>,
    tolerateFailure = false
  ): Promise<void> {
    const pluginId = entry.record.manifest.pluginId;

    if (!entry.record.manifest.lifecycleHooks.includes(hook)) {
      return;
    }

    const fn = entry.implementation?.hooks?.[hook];

    if (!fn) {
      return;
    }

    try {
      await withTimeout(
        Promise.resolve().then(fn),
        this.hookTimeoutMs,
        `Plugin ${pluginId} ${hook}`
      );
    } catch (error) {
      const message =
        error instanceof TimeoutError
          ? `${hook} timed out after ${this.hookTimeoutMs}ms.`
          : `${hook} failed: ${errorMessage(error)}`;

      entry.record.error = message;
      entry.record.health = this.failedHealth(entry.record.health, message);

      if (entry.record.manifest.lifecycleHooks.includes('onError')) {
        const onError = entry.implementation?.hooks?.onError;

        if (onError) {
          try {
            await withTimeout(
              Promise.resolve().then(onError),
              ERROR_HOOK_TIMEOUT_MS,
              `Plugin ${pluginId} onError`
            );
          } catch (onErrorFailure) {
            this.log(`Plugin ${pluginId} onError failed.`, onErrorFailure);
          }
        }
      }

      this.emitSafe('plugin.error', {
        pluginId,
        error: message,
        hook,
      });

      if (tolerateFailure) {
        this.log(`Plugin ${pluginId} ${hook} failed during shutdown.`, error);
        return;
      }

      throw new PluginLifecycleError(pluginId, hook, message);
    }
  }

  private healthyHealth(): PluginHealth {
    return {
      status: 'healthy',
      failures: 0,
      lastError: null,
      lastCheckedAt: this.now(),
    };
  }

  private failedHealth(health: PluginHealth, error: string): PluginHealth {
    const failures = health.failures + 1;

    return {
      status: failures >= 3 ? 'failing' : 'degraded',
      failures,
      lastError: error,
      lastCheckedAt: this.now(),
    };
  }

  private requireEntry(pluginId: string): RegistryEntry {
    const entry = this.entries.get(pluginId);

    if (!entry) {
      throw new PluginRegistryError(`Plugin "${pluginId}" is not registered.`);
    }

    return entry;
  }

  private findDependents(pluginId: string): string[] {
    const dependents: string[] = [];

    for (const [candidateId, entry] of this.entries) {
      if (candidateId === pluginId) {
        continue;
      }

      if (!INSTALLED_STATUSES.includes(entry.record.status)) {
        continue;
      }

      if (
        entry.record.manifest.dependencies.some(
          (dependency) => dependency.pluginId === pluginId
        )
      ) {
        dependents.push(candidateId);
      }
    }

    return dependents.sort();
  }

  private async snapshotData(pluginId: string): Promise<DataSnapshot> {
    const [settings, kv] = await Promise.all([
      this.options.persistence.listSettings(pluginId),
      this.options.persistence.listKv(pluginId),
    ]);

    return {
      settings: settings.map((record) => ({
        key: record.key,
        value: record.value,
      })),
      kv: kv.map((record) => ({
        key: record.key,
        value: record.value,
        bytes: record.bytes,
      })),
    };
  }

  private async restoreData(pluginId: string, snapshot: DataSnapshot): Promise<void> {
    await this.options.persistence.deleteAllSettings(pluginId);
    await this.options.persistence.clearKv(pluginId);

    for (const setting of snapshot.settings) {
      await this.options.persistence.saveSetting({
        pluginId,
        key: setting.key,
        value: setting.value,
        updatedAt: this.now(),
      });
    }

    for (const kv of snapshot.kv) {
      await this.options.persistence.setKv({
        pluginId,
        key: kv.key,
        value: kv.value,
        updatedAt: this.now(),
        bytes: kv.bytes,
      });
    }
  }

  getRecord(pluginId: string): PluginRecord | null {
    return this.entries.get(pluginId)?.record ?? null;
  }

  getManifest(pluginId: string): PluginManifest {
    return this.requireEntry(pluginId).record.manifest;
  }

  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    return this.options.permissions.has(pluginId, permission);
  }

  async approvePermissions(
    pluginId: string,
    permissions: PluginPermission[],
    reason: string
  ): Promise<void> {
    const entry = this.requireEntry(pluginId);
    const invalid = permissions.filter(
      (permission) => !entry.record.manifest.permissions.includes(permission)
    );

    if (invalid.length > 0) {
      throw new PluginRegistryError(
        `Plugin "${pluginId}" did not request: ${invalid.join(', ')}.`
      );
    }

    await this.options.permissions.grant(pluginId, permissions, 'user', reason);
    this.refreshGrants(entry);

    for (const permission of permissions) {
      this.emitSafe('plugin.permission.changed', {
        pluginId,
        permission,
        granted: true,
      });
    }

    this.notify();
  }

  async revokePermission(
    pluginId: string,
    permission: PluginPermission
  ): Promise<PluginRecord> {
    const entry = this.requireEntry(pluginId);

    if (ACTIVE_STATUSES.includes(entry.record.status)) {
      await this.disable(pluginId, 'Permission revoked by the user.');
    }

    await this.options.permissions.revoke(pluginId, permission);
    this.refreshGrants(entry);
    this.emitSafe('plugin.permission.changed', {
      pluginId,
      permission,
      granted: false,
    });
    this.notify();
    return entry.record;
  }

  async registerTool(
    pluginId: string,
    definition: PluginToolDefinition
  ): Promise<() => void> {
    const entry = this.requireEntry(pluginId);
    const manifest = entry.record.manifest;

    if (!['starting', 'running'].includes(entry.record.status)) {
      throw new PluginRegistryError(
        `Plugin "${pluginId}" can only register tools while starting or running.`
      );
    }

    if (!this.options.toolHost) {
      throw new PluginRegistryError('No tool host is available for plugin tools.');
    }

    if (!manifest.permissions.includes('ai.invoke')) {
      throw new PluginRegistryError(
        `Plugin "${pluginId}" must request "ai.invoke" before registering tools.`
      );
    }

    this.options.permissions.assert(pluginId, 'ai.invoke');

    if (!isRecord(definition.parameters)) {
      throw new PluginRegistryError('Tool parameters must be a JSON schema object.');
    }

    if (!isValidPluginToolName(definition.name)) {
      throw new PluginRegistryError(`Invalid plugin tool name "${definition.name}".`);
    }

    for (const permission of definition.permissions ?? []) {
      if (!(PLUGIN_PERMISSIONS as readonly string[]).includes(permission)) {
        throw new PluginRegistryError(`Unknown tool permission "${permission}".`);
      }

      if (!manifest.permissions.includes(permission)) {
        throw new PluginRegistryError(
          `Tool "${definition.name}" requires "${permission}", which the manifest does not declare.`
        );
      }
    }

    if (entry.toolUnregisters.has(definition.name)) {
      throw new PluginRegistryError(
        `Plugin "${pluginId}" already registered tool "${definition.name}".`
      );
    }

    const exposedName = namespacedPluginToolName(pluginId, definition.name);

    if (
      !exposedName.startsWith(pluginToolNamespace(pluginId)) ||
      exposedName === pluginToolNamespace(pluginId)
    ) {
      throw new PluginRegistryError(
        `Plugin tool "${exposedName}" is outside the plugin's tool namespace.`
      );
    }

    assertToolCanRegister(this.options.toolHost, exposedName);

    const tool: AgentTool = buildPluginAgentTool({
      pluginId,
      pluginName: manifest.name,
      trustLevel: entry.record.trustLevel,
      definition,
      grantedPermissions: () => this.options.permissions.activeGrants(pluginId),
      assertPermission: (permission) => {
        this.options.permissions.assert(pluginId, permission);
      },
      isActive: () =>
        this.entries.get(pluginId)?.record.status === 'running',
      requiresApproval: async (toolName) => {
        if (!this.options.confirmSensitiveTool) {
          return false;
        }

        return this.options.confirmSensitiveTool({
          pluginId,
          pluginName: manifest.name,
          toolName,
        });
      },
      log: (message, detail) => this.log(message, detail),
    });

    this.options.toolHost.register(tool);
    let disposed = false;
    const unregister = (): void => {
      if (disposed) {
        return;
      }

      disposed = true;
      this.options.toolHost?.unregister(exposedName);
      entry.toolUnregisters.delete(definition.name);
    };

    entry.toolUnregisters.set(definition.name, unregister);
    return unregister;
  }

  async getSettings(pluginId: string): Promise<Record<string, unknown>> {
    const entry = this.requireEntry(pluginId);
    const stored = await this.options.persistence.listSettings(pluginId);
    const values: Record<string, unknown> = {};

    for (const setting of stored) {
      values[setting.key] = setting.value;
    }

    return withSettingDefaults(entry.record.manifest.settingsSchema, values);
  }

  async setSetting(pluginId: string, key: string, value: unknown): Promise<void> {
    const entry = this.requireEntry(pluginId);
    const manifest = entry.record.manifest;

    if (!INSTALLED_STATUSES.includes(entry.record.status) && entry.record.status !== 'available') {
      throw new PluginSettingError(
        `Plugin "${pluginId}" must be installed before changing settings.`
      );
    }

    if (isSecretSettingKey(key)) {
      throw new PluginSettingError(
        `Setting "${key}" looks like a secret. Use the credentials API with the "credentials.request" permission instead.`
      );
    }

    const field = manifest.settingsSchema.find((candidate) => candidate.key === key);

    if (!field) {
      throw new PluginSettingError(
        `Plugin "${pluginId}" does not declare the setting "${key}".`
      );
    }

    const validation = validateSettingValue(field, value);

    if (!validation.ok) {
      throw new PluginSettingError(validation.error);
    }

    await this.options.persistence.saveSetting({
      pluginId,
      key,
      value: validation.value,
      updatedAt: this.now(),
    });
    this.notify();
  }

  async deleteSetting(pluginId: string, key: string): Promise<void> {
    this.requireEntry(pluginId);
    await this.options.persistence.deleteSetting(pluginId, key);
    this.notify();
  }

  getSettingField(pluginId: string, key: string): PluginSettingField | null {
    return (
      this.requireEntry(pluginId).record.manifest.settingsSchema.find(
        (field) => field.key === key
      ) ?? null
    );
  }

  listInstalled(): PluginRecord[] {
    return Array.from(this.entries.values())
      .filter((entry) => INSTALLED_STATUSES.includes(entry.record.status))
      .map((entry) => entry.record)
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  listAvailable(): PluginRecord[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.record.status === 'available')
      .map((entry) => entry.record)
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  listAll(): PluginRecord[] {
    return Array.from(this.entries.values())
      .map((entry) => entry.record)
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  getSummaries(): PluginSummary[] {
    return this.listAll().map((record) => {
      const catalog = this.catalog.get(record.manifest.pluginId);
      const hasUpdate = Boolean(
        catalog &&
          INSTALLED_STATUSES.includes(record.status) &&
          satisfiesRange(
            catalog.manifest.version,
            `>${record.manifest.version}`
          )
      );

      return {
        manifest: record.manifest,
        trustLevel: record.trustLevel,
        source: record.source,
        status: record.status,
        enabled: record.enabled,
        running: record.status === 'running',
        grantedPermissions: this.options.permissions.activeGrants(
          record.manifest.pluginId
        ),
        missingPermissions: this.options.permissions.missing(
          record.manifest.pluginId,
          record.manifest.permissions
        ),
        installedAt: record.installedAt || null,
        updatedAt: record.updatedAt || null,
        error: record.error,
        health: record.health,
        legacy: record.legacy,
        hasUpdate,
      };
    });
  }

  getCatalogEntries(): PluginCatalogEntry[] {
    return Array.from(this.catalog.values())
      .map((item) => {
        const installed = this.entries.get(item.manifest.pluginId)?.record;
        const installedVersion =
          installed && INSTALLED_STATUSES.includes(installed.status)
            ? installed.manifest.version
            : null;
        let incompatibleReason: string | undefined;

        try {
          this.checkCompatibility(item.manifest);
        } catch (error) {
          incompatibleReason = errorMessage(error);
        }

        return {
          manifest: item.manifest,
          trustLevel: item.trustLevel,
          publisher: item.manifest.publisher,
          screenshots: [...item.screenshots],
          readme: item.readme,
          source: (item.source === 'builtin' ? 'builtin' : item.source === 'local' ? 'local' : 'catalog') as PluginCatalogEntry['source'],
          compatible: !incompatibleReason,
          incompatibleReason,
          installedVersion,
          availableVersion: item.manifest.version,
          hasUpdate: Boolean(
            installedVersion &&
              satisfiesRange(
                item.manifest.version,
                `>${installedVersion}`
              )
          ),
        };
      })
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  getStartupOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];
    const ids = this.listInstalled()
      .map((record) => record.manifest.pluginId)
      .sort();

    const visit = (pluginId: string): void => {
      if (visited.has(pluginId)) {
        return;
      }

      if (visiting.has(pluginId)) {
        throw new DependencyResolutionError(
          `Dependency cycle detected at "${pluginId}".`
        );
      }

      visiting.add(pluginId);
      const manifest = this.entries.get(pluginId)?.record.manifest;

      for (const dependency of [...(manifest?.dependencies ?? [])].sort((a, b) =>
        a.pluginId.localeCompare(b.pluginId)
      )) {
        if (this.entries.has(dependency.pluginId)) {
          visit(dependency.pluginId);
        }
      }

      visiting.delete(pluginId);
      visited.add(pluginId);
      order.push(pluginId);
    };

    for (const id of ids) {
      visit(id);
    }

    return order;
  }

  getRuntimeStats(
    bootstrapMs: number | null = null,
    lastBootstrapError: string | null = null
  ): PluginRuntimeStats {
    const records = this.listAll();
    const summaries = this.getSummaries();

    return {
      total: records.length,
      installed: records.filter((record) =>
        INSTALLED_STATUSES.includes(record.status)
      ).length,
      running: records.filter((record) => record.status === 'running').length,
      enabled: records.filter((record) => record.enabled).length,
      disabled: records.filter((record) => record.status === 'disabled').length,
      available: records.filter((record) => record.status === 'available').length,
      errors: records.filter((record) => record.status === 'error').length,
      updates: summaries.filter((summary) => summary.hasUpdate).length,
      bootstrapMs,
      lastBootstrapError,
    };
  }

  getNavigationEntries() {
    return this.contributingEntries().flatMap((entry) =>
      entry.record.manifest.navigationEntries.map((item) => ({
        pluginId: entry.record.manifest.pluginId,
        pluginName: entry.record.manifest.name,
        trustLevel: entry.record.trustLevel,
        ...item,
        path: `/plugin/${entry.record.manifest.pluginId}?screen=${encodeURIComponent(item.routeId)}`,
      }))
    ).sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.pluginName.localeCompare(b.pluginName));
  }

  getWidgets() {
    return this.contributingEntries().flatMap((entry) =>
      entry.record.manifest.dashboardWidgets.map((widget) => ({
        pluginId: entry.record.manifest.pluginId,
        pluginName: entry.record.manifest.name,
        ...widget,
      }))
    );
  }

  getSettingsSections() {
    return this.contributingEntries().flatMap((entry) =>
      entry.record.manifest.settingsSections.map((section) => ({
        pluginId: entry.record.manifest.pluginId,
        pluginName: entry.record.manifest.name,
        ...section,
        path: `/plugin/${entry.record.manifest.pluginId}`,
      }))
    );
  }

  getToolbarActions(pluginId?: string) {
    return this.contributingEntries()
      .filter((entry) => !pluginId || entry.record.manifest.pluginId === pluginId)
      .flatMap((entry) =>
        entry.record.manifest.toolbarActions.map((action) => ({
          pluginId: entry.record.manifest.pluginId,
          pluginName: entry.record.manifest.name,
          ...action,
        }))
      );
  }

  getContextActions(pluginId?: string) {
    return this.contributingEntries()
      .filter((entry) => !pluginId || entry.record.manifest.pluginId === pluginId)
      .flatMap((entry) =>
        entry.record.manifest.contextActions.map((action) => ({
          pluginId: entry.record.manifest.pluginId,
          pluginName: entry.record.manifest.name,
          ...action,
        }))
      );
  }

  getRoutes(pluginId: string) {
    const entry = this.entries.get(pluginId);

    if (!entry || !ACTIVE_STATUSES.includes(entry.record.status)) {
      return [];
    }

    return entry.record.manifest.routes.map((route) => ({
      ...route,
      pluginId,
      path: `/plugin/${pluginId}?screen=${encodeURIComponent(route.id)}`,
    }));
  }

  private contributingEntries(): RegistryEntry[] {
    return Array.from(this.entries.values()).filter(
      (entry) =>
        entry.record.status === 'running' &&
        entry.record.manifest.permissions.includes('ui.contribute') &&
        this.options.permissions.has(
          entry.record.manifest.pluginId,
          'ui.contribute'
        )
    );
  }

  async permissionAudit(
    pluginId?: string,
    limit?: number
  ): Promise<PermissionAuditRecord[]> {
    return this.options.persistence.listPermissionAudit(pluginId, limit);
  }

  async installHistory(pluginId: string, limit?: number) {
    return this.options.persistence.listInstallHistory(pluginId, limit);
  }

  async getHealth(pluginId: string): Promise<PluginHealth> {
    return this.requireEntry(pluginId).record.health;
  }

  async pingHealth(pluginId: string): Promise<PluginHealth> {
    const entry = this.requireEntry(pluginId);

    if (entry.record.status === 'running') {
      entry.record.health = this.healthyHealth();
    } else {
      entry.record.health = {
        ...entry.record.health,
        lastCheckedAt: this.now(),
      };
    }

    await this.persist(entry);
    this.notify();
    return entry.record.health;
  }

  approveCatalogPermission(
    pluginId: string
  ): PluginPermission[] {
    return this.requireEntry(pluginId).record.manifest.permissions;
  }
}

type DataSnapshot = {
  settings: { key: string; value: unknown }[];
  kv: { key: string; value: string; bytes: number }[];
};

export type {
  PluginSummary,
  PluginRuntimeStats,
  PluginCatalogEntry,
  PluginRecord,
};
