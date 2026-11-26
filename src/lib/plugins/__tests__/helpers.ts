import type { AgentTool } from '@/lib/ai/tool-registry';
import type { McpServerConfig } from '@/lib/mcp/settings';

import { PluginEventBus } from '../events';
import { PluginPermissionManager } from '../permissions';
import { MemoryPluginPersistence } from '../persistence';
import { PluginRegistry } from '../registry';
import type { PluginToolHost } from '../tools';
import type {
  PersistedPlugin,
  PluginManifest,
  PluginPlatform,
} from '../types';

export function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    pluginId: 'test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A plugin used by unit tests.',
    author: { name: 'Test Author' },
    publisher: { id: 'test-publisher', name: 'Test Publisher', verified: false },
    category: 'service',
    icon: 'puzzle-outline',
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
    ...overrides,
  };
}

/** A plain-object manifest that can be mutated into invalid shapes. */
export function rawManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...makeManifest(), ...overrides };
}

export type FakeToolHost = PluginToolHost & { tools: Map<string, AgentTool> };

export function createToolHost(): FakeToolHost {
  const tools = new Map<string, AgentTool>();

  return {
    tools,
    register(tool) {
      tools.set(tool.definition.name, tool);
    },
    unregister(name) {
      return tools.delete(name);
    },
    has(name) {
      return tools.has(name);
    },
  };
}

export type Harness = {
  persistence: MemoryPluginPersistence;
  permissions: PluginPermissionManager;
  events: PluginEventBus;
  registry: PluginRegistry;
  toolHost: FakeToolHost;
};

export function createHarness(
  options: {
    appVersion?: string;
    platform?: PluginPlatform;
    now?: () => number;
    toolHost?: FakeToolHost;
    persistence?: MemoryPluginPersistence;
    hookTimeoutMs?: number;
    confirmSensitiveTool?: (input: {
      pluginId: string;
      pluginName: string;
      toolName: string;
    }) => Promise<boolean>;
    logger?: (message: string, detail?: unknown) => void;
  } = {}
): Harness {
  const persistence = options.persistence ?? new MemoryPluginPersistence();
  const now = options.now ?? (() => 1_000);
  const permissions = new PluginPermissionManager(persistence, now);
  const events = new PluginEventBus(now);
  const toolHost = options.toolHost ?? createToolHost();
  const registry = new PluginRegistry({
    appVersion: options.appVersion ?? '1.10.6',
    platform: options.platform ?? 'android',
    persistence,
    permissions,
    events,
    toolHost,
    now,
    hookTimeoutMs: options.hookTimeoutMs,
    confirmSensitiveTool: options.confirmSensitiveTool,
    logger: options.logger ?? (() => undefined),
  });

  return { persistence, permissions, events, registry, toolHost };
}

export function persistedPlugin(
  manifest: PluginManifest,
  overrides: Partial<PersistedPlugin> = {}
): PersistedPlugin {
  return {
    manifest,
    manifestJson: JSON.stringify(manifest),
    trustLevel: 'local',
    source: 'local',
    status: 'installed',
    enabled: false,
    installedAt: 1,
    updatedAt: 1,
    lastStartedAt: null,
    lastStoppedAt: null,
    error: null,
    health: { status: 'unknown', failures: 0, lastError: null, lastCheckedAt: null },
    legacy: false,
    ...overrides,
  };
}

export function mcpServer(
  overrides: Partial<McpServerConfig> = {}
): McpServerConfig {
  return {
    id: 'mcp_alpha',
    name: 'Alpha Server',
    url: 'https://alpha.example.test/mcp',
    token: 'top-secret-token',
    enabled: true,
    ...overrides,
  };
}
