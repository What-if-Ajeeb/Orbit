/**
 * Canonical ORBIT plugin platform types.
 *
 * These types are the single source of truth for plugin manifests, lifecycle
 * state, permissions, contributions and persisted records. Runtime code here
 * never imports React Native, SQLite or Cordis; the SQLite reference below is a
 * type-only import and is erased at build time so the platform stays testable.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

export const PLUGIN_MANIFEST_VERSION = 1;

export const PLUGIN_CATEGORIES = [
  'ui',
  'service',
  'tool',
  'mcp',
  'ai',
  'storage',
  'automation',
  'provider',
  'integration',
  'background',
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export const PLUGIN_CAPABILITIES = [
  'ui.screens',
  'ui.navigation',
  'ui.widgets',
  'ui.settings',
  'ui.toolbar',
  'ui.context-menu',
  'tools.ai',
  'tools.mcp',
  'provider.llm',
  'storage.namespaced',
  'events.publish',
  'events.subscribe',
  'automation.triggers',
  'background.tasks',
  'integration.mcp',
  'ai.context',
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_PERMISSIONS = [
  'network.access',
  'storage.read',
  'storage.write',
  'files.read',
  'files.write',
  'notifications.send',
  'camera.access',
  'microphone.access',
  'location.access',
  'contacts.read',
  'calendar.read',
  'calendar.write',
  'clipboard.read',
  'clipboard.write',
  'ai.invoke',
  'ai.context.read',
  'mcp.connect',
  'credentials.request',
  'background.execute',
  'ui.contribute',
  'sandbox.inspect',
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PLUGIN_TRUST_LEVELS = [
  'official',
  'verified',
  'community',
  'local',
  'untrusted',
] as const;

export type PluginTrustLevel = (typeof PLUGIN_TRUST_LEVELS)[number];

export const PLUGIN_SOURCES = ['builtin', 'catalog', 'local', 'legacy'] as const;
export type PluginSource = (typeof PLUGIN_SOURCES)[number];

export const PLUGIN_STATUSES = [
  'discovered',
  'available',
  'installing',
  'installed',
  'disabled',
  'enabling',
  'enabled',
  'starting',
  'running',
  'stopping',
  'error',
  'updating',
  'uninstalling',
] as const;

export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const PLUGIN_PLATFORMS = ['android', 'ios', 'web'] as const;
export type PluginPlatform = (typeof PLUGIN_PLATFORMS)[number];

export const PLUGIN_LIFECYCLE_HOOKS = [
  'onInstall',
  'onInitialize',
  'onStart',
  'onStop',
  'onEnable',
  'onDisable',
  'onUpdate',
  'onUninstall',
  'onError',
] as const;

export type PluginLifecycleHook = (typeof PLUGIN_LIFECYCLE_HOOKS)[number];

export const PLUGIN_UPDATE_POLICIES = ['manual', 'notify', 'auto-safe'] as const;
export type PluginUpdatePolicy = (typeof PLUGIN_UPDATE_POLICIES)[number];

export const PLUGIN_ENTRY_KINDS = ['builtin', 'declarative', 'mcp'] as const;
export type PluginEntryKind = (typeof PLUGIN_ENTRY_KINDS)[number];

export type PluginAuthor = {
  name: string;
  url?: string;
};

export type PluginPublisher = {
  id: string;
  name: string;
  verified: boolean;
};

export type PluginDependency = {
  pluginId: string;
  /** Semantic-version range, e.g. `^1.2.0`, `~2.0.0`, `>=1.0.0 <2.0.0`. */
  version: string;
};

export type PluginEntryPoint =
  | {
      kind: 'builtin';
      /**
       * A key registered with `registerBuiltinPlugin`. This is never a file
       * path and is not importable by third-party manifests.
       */
      moduleId: string;
    }
  | {
      kind: 'declarative';
      screen?: 'plugin-home';
    }
  | {
      kind: 'mcp';
      /** Optional stable server id. MCP servers are registered by the app. */
      serverId?: string;
    };

export type PluginRouteContribution = {
  /** Stable route id, unique inside the plugin. */
  id: string;
  /** Only approved Orbit screens can be targeted. */
  screen: 'plugin-home';
  title: string;
};

export type PluginNavigationEntry = {
  id: string;
  label: string;
  /** Ionicons glyph name; rendered by the app, never evaluated. */
  icon: string;
  /** Must reference a route contribution in the same manifest. */
  routeId: string;
  order?: number;
};

export type PluginDashboardWidget = {
  id: string;
  title: string;
  description: string;
  size?: 'small' | 'medium' | 'large';
};

export type PluginSettingsSection = {
  id: string;
  title: string;
  description?: string;
};

export type PluginToolbarAction = {
  id: string;
  label: string;
  icon: string;
  /** Typed event emitted when the action is pressed. */
  event: string;
};

export type PluginContextAction = PluginToolbarAction & {
  context: 'plugin-home' | 'sidebar';
};

export type PluginSettingOption = {
  value: string;
  label: string;
};

export type PluginSettingField =
  | {
      key: string;
      type: 'string';
      label: string;
      description?: string;
      default?: string;
      required?: boolean;
    }
  | {
      key: string;
      type: 'number';
      label: string;
      description?: string;
      default?: number;
      minimum?: number;
      maximum?: number;
      required?: boolean;
    }
  | {
      key: string;
      type: 'boolean';
      label: string;
      description?: string;
      default?: boolean;
      required?: boolean;
    }
  | {
      key: string;
      type: 'select';
      label: string;
      description?: string;
      options: PluginSettingOption[];
      default?: string;
      required?: boolean;
    };

export type PluginMcpToolDeclaration = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type PluginEventDeclaration = {
  emits: string[];
  listens: string[];
};

export type PluginManifest = {
  manifestVersion: number;
  pluginId: string;
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  publisher: PluginPublisher;
  category: PluginCategory;
  /** Ionicons glyph name or a short asset key. Never executable code. */
  icon?: string;
  minimumOrbitVersion: string;
  platformSupport: PluginPlatform[];
  entryPoint: PluginEntryPoint;
  permissions: PluginPermission[];
  capabilities: PluginCapability[];
  dependencies: PluginDependency[];
  optionalDependencies: PluginDependency[];
  routes: PluginRouteContribution[];
  navigationEntries: PluginNavigationEntry[];
  dashboardWidgets: PluginDashboardWidget[];
  settingsSections: PluginSettingsSection[];
  settingsSchema: PluginSettingField[];
  toolbarActions: PluginToolbarAction[];
  contextActions: PluginContextAction[];
  mcpTools: PluginMcpToolDeclaration[];
  events: PluginEventDeclaration;
  lifecycleHooks: PluginLifecycleHook[];
  dataSchemaVersion: number;
  updatePolicy: PluginUpdatePolicy;
};

export type PluginHealth = {
  status: 'unknown' | 'healthy' | 'degraded' | 'failing';
  failures: number;
  lastError: string | null;
  lastCheckedAt: number | null;
};

export type PluginRecord = {
  manifest: PluginManifest;
  trustLevel: PluginTrustLevel;
  source: PluginSource;
  status: PluginStatus;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
  installedAt: number;
  updatedAt: number;
  lastStartedAt: number | null;
  lastStoppedAt: number | null;
  error: string | null;
  health: PluginHealth;
  /** Set for records imported from the legacy `plugins` table. */
  legacy: boolean;
};

export type PersistedPlugin = Omit<
  PluginRecord,
  'manifest' | 'grantedPermissions'
> & {
  manifest: PluginManifest;
  manifestJson: string;
};

export type PermissionGrantRecord = {
  pluginId: string;
  permission: PluginPermission;
  granted: boolean;
  source: PermissionGrantSource;
  grantedAt: number;
  revokedAt: number | null;
};

export const PERMISSION_GRANT_SOURCES = [
  'user',
  'core',
  'mcp_settings',
  'migration',
] as const;

export type PermissionGrantSource = (typeof PERMISSION_GRANT_SOURCES)[number];

export type PermissionAuditEvent =
  | 'permissions_requested'
  | 'permissions_granted'
  | 'permissions_denied'
  | 'permission_revoked'
  | 'permissions_revoked_all'
  | 'permissions_changed_on_update'
  | 'permission_denied_at_runtime'
  | 'mcp_consent_created'
  | 'sandbox_operation';

export type PermissionAuditRecord = {
  id: number;
  pluginId: string;
  event: PermissionAuditEvent;
  permissions: PluginPermission[];
  source: PermissionGrantSource | 'system';
  detail: string;
  createdAt: number;
};

export type InstallHistoryAction =
  | 'discovered'
  | 'install'
  | 'enable'
  | 'disable'
  | 'update'
  | 'uninstall'
  | 'rollback'
  | 'recovered'
  | 'migrated';

export type InstallHistoryRecord = {
  id: number;
  pluginId: string;
  action: InstallHistoryAction;
  fromVersion: string | null;
  toVersion: string | null;
  status: 'started' | 'succeeded' | 'failed';
  detail: string;
  createdAt: number;
};

export type PluginBackupRecord = {
  id: number;
  pluginId: string;
  fromVersion: string;
  toVersion: string;
  data: string;
  createdAt: number;
};

export type PluginSettingRecord = {
  pluginId: string;
  key: string;
  value: unknown;
  updatedAt: number;
};

export type PluginKvRecord = {
  pluginId: string;
  key: string;
  value: string;
  updatedAt: number;
  bytes: number;
};

export type PluginSummary = {
  manifest: PluginManifest;
  trustLevel: PluginTrustLevel;
  source: PluginSource;
  status: PluginStatus;
  enabled: boolean;
  running: boolean;
  grantedPermissions: PluginPermission[];
  missingPermissions: PluginPermission[];
  installedAt: number | null;
  updatedAt: number | null;
  error: string | null;
  health: PluginHealth;
  legacy: boolean;
  hasUpdate: boolean;
};

export type PluginCatalogEntry = {
  manifest: PluginManifest;
  trustLevel: PluginTrustLevel;
  publisher: PluginPublisher;
  screenshots: string[];
  readme: string;
  source: 'builtin' | 'catalog' | 'local';
  compatible: boolean;
  incompatibleReason?: string;
  installedVersion: string | null;
  availableVersion: string;
  hasUpdate: boolean;
};

export type PluginRuntimeStats = {
  total: number;
  installed: number;
  running: number;
  enabled: number;
  disabled: number;
  available: number;
  errors: number;
  updates: number;
  bootstrapMs: number | null;
  lastBootstrapError: string | null;
};

/**
 * UI components are registered by reviewed built-in code only. Manifest
 * contributions can point at these renderers, but can never supply code.
 */
export type PluginScreenRenderer = (props: { pluginId: string }) => unknown;

export type PluginWidgetRenderer = (props: {
  pluginId: string;
  widgetId: string;
}) => unknown;

export type PluginHook = () => void | Promise<void>;

/**
 * Context passed to a reviewed built-in tool body. `db` and `userId` are only
 * supplied by the host for reviewed `official` builtins; declarative and
 * untrusted plugins never receive an executable tool body at all.
 */
export type PluginSdkToolContext = {
  signal?: AbortSignal;
  log: (message: string, detail?: unknown) => void;
  db?: SQLiteDatabase;
  userId?: number;
  conversationId?: number;
};

export type PluginSdkToolResult = {
  content: string;
  trace: string;
};

export type PluginJsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type PluginToolDefinition = {
  name: string;
  description: string;
  parameters: PluginJsonSchema;
  outputSchema?: Record<string, unknown>;
  /** Extra permissions enforced for this specific tool call. */
  permissions?: PluginPermission[];
  /** Ask the user before every call, on top of the enable-time grant. */
  requiresApproval?: boolean;
  timeoutMs?: number;
  /**
   * Reviewed host implementation. The sandbox has no guest-code tool body:
   * `program`, `instructions` and `sandbox.execute` are rejected.
   */
  execute: (
    args: Record<string, unknown>,
    context: PluginSdkToolContext
  ) => Promise<PluginSdkToolResult>;
};

export type PluginImplementation = {
  hooks?: Partial<Record<PluginLifecycleHook, PluginHook>>;
  activate?: (sdk: import('./sdk').OrbitPluginSdk) => void | Promise<void>;
  deactivate?: (sdk: import('./sdk').OrbitPluginSdk) => void | Promise<void>;
};

export type PluginDefinition = {
  manifest: PluginManifest;
  implementation: PluginImplementation;
};
