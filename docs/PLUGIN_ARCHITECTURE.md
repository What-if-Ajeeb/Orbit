# Plugin platform architecture

This document describes the plugin platform as implemented in this tree. It is
the manifest-driven layer under `src/lib/plugins/`, the provider in
`src/context/plugins.tsx`, the Plugin Manager screens, and the v12 SQLite schema
in `src/lib/db.ts`. It is distinct from the older harness seams described in
[`HARNESS.md`](HARNESS.md).

For manifest fields, see [`PLUGIN_MANIFEST.md`](PLUGIN_MANIFEST.md). For trust
and containment, see [`PLUGIN_SECURITY.md`](PLUGIN_SECURITY.md). For the narrow
SDK, see [`PLUGIN_SDK.md`](PLUGIN_SDK.md).

## Composition root

`PluginPlatformRuntime` (`src/lib/plugins/platform.ts`) owns the single
instances of:

- `SqlitePluginPersistence` — the only plugin component that touches the
  plugin-specific SQLite tables. `MemoryPluginPersistence` also exists for
  headless use.
- `PluginPermissionManager` — per-plugin default-deny grants and an audit log.
- `PluginEventBus` — in-process typed events with payload sanitization and
  dispatch limits.
- `PluginRegistry` — manifests, lifecycle state, dependencies, contributions,
  settings and tool registration.
- `PluginKeyValueStorage` — namespaced JSON values with a 1 MB quota per plugin.

A process-wide singleton is created by `initializePluginPlatform(options)`,
read by `getPluginPlatform()`, and cleared by `disposePluginPlatform()`, which
also removes the MCP tool gate. The constructor installs `setMcpToolGate(...)`;
before bootstrap and MCP record sync, no synthetic record exists, so every MCP
tool call is denied. `PluginPlatformProvider` calls `initialize()` once, does
not block rendering, and exposes snapshots through
`usePluginSnapshot()`, `usePluginPlatform()` and `usePluginPlatformError()` via
`useSyncExternalStore`. The provider and `PluginApprovalHost` are mounted in
`src/app/(app)/_layout.tsx`.

## Bootstrap sequence

`PluginPlatformRuntime.bootstrap()` runs once:

1. Load permission grants from persistence.
2. Load persisted plugin records and call `registry.restore()`. Interrupted
   `installing`/`updating`/`uninstalling` records and any record in an active
   state (`enabled`, `starting`, `running`) are restored as `disabled`. Records
   that were both `enabled` and active are returned as resumable ids.
3. Register the bundled catalog: five Cordis core service manifests, the
   built-in diagnostics manifest, and `plugins/example-plugin/manifest.json`.
   Registering a catalog entry makes it available; it does not install it.
4. Register reviewed built-in implementations from `BUILTIN_IMPLEMENTATIONS`.
   Only the diagnostics module is present.
5. Adopt the five Cordis spine plugins as `official`/`builtin` records with
   status `running` and `enabled = true`. The existing Cordis harness still
   mounts them; the platform does not mount or execute them again.
6. Import rows from the legacy `plugins` table once as `untrusted`, `disabled`,
   `legacy` records. No legacy code is loaded.
7. Install and enable built-in diagnostics once, using a `plugin_meta` marker.
   Its declared `ui.contribute` permission is granted with source `core`.
8. Load MCP server settings and mirror each server into a synthetic
   `mcp.server.*` plugin. The gate was already installed by the constructor.
9. Re-enable resumable plugins via `registry.getStartupOrder()`, with a sorted
   fallback if ordering fails.

Bootstrap errors are stored on the runtime, logged, rethrown to the provider,
and shown by the Plugin Manager. `bootstrapMs` and `lastBootstrapError` are
part of the snapshot stats.

## Registry and lifecycle

`PluginRegistry` holds records in memory and persists them through
`PluginPersistence`. Statuses are `discovered`, `available`, `installing`,
`installed`, `disabled`, `enabling`, `enabled`, `starting`, `running`,
`stopping`, `error`, `updating` and `uninstalling`. Every transition is checked
against `PLUGIN_STATE_TRANSITIONS`; failure paths force `error` or `disabled`
instead of leaving a plugin half-running.

- `discover()` validates the manifest, rejects duplicates, enforces
  `isEntryPointAllowed()` (reserved ids and `builtin` entry points require
  `official` trust), checks platform and `minimumOrbitVersion`, applies the
  contribution policy, and rejects dependency cycles.
- `install()` auto-installs required dependencies from the catalog, runs
  `onInstall`, records version/dependency metadata and install history, and
  leaves the plugin installed but disabled. Optional dependencies are not
  auto-installed.
- `enable()` requires all declared permissions to be active, runs `onEnable`,
  creates the SDK (running `onInitialize` on first creation), runs `onStart`,
  calls `activate()` only for a reviewed built-in implementation, and reaches
  `running`.
- `disable()` deactivates the implementation, unregisters plugin tools, clears
  SDK event subscriptions, runs `onStop`/`onDisable` with failures tolerated,
  and reaches `disabled`.
- `uninstall()` refuses when another installed plugin depends on it, revokes
  all permissions, optionally deletes settings/KV data, removes the record,
  and re-adds the catalog entry as `available`.
- `update()` requires a strictly greater semver version, same `pluginId`,
  approved added permissions, and compatibility checks. It snapshots settings
  and KV, runs `onUpdate`, applies manifest/permission changes, and rolls back
  on failure. A running plugin is disabled first and re-enabled on success.

Hook failures and timeouts record error/health state, emit `plugin.error`, call
`onError` when declared and implemented (with a 2,000 ms timeout), and abort
the operation unless the shutdown path explicitly tolerates failure. Normal
hooks use a 5,000 ms hard timeout.

## Dependencies, catalog and persistence

Dependencies use `{ pluginId, version }`, where `version` is validated by the
semver parser. Supported ranges include exact versions, `=`, `^`, `~`,
comparators, wildcards, space-separated conjunctions and `||` alternatives.
Required dependencies must be installed and active before enable; optional
dependencies must satisfy their range if installed. Cycles are rejected during
discovery, install, update and startup ordering.

The catalog is a local list of bundled manifests plus out-of-band `readme` and
`screenshots` text. There is no remote catalog fetch, downloader, or code
loader.

Tables created by the v12 migration in `src/lib/db.ts`: `plugin_records`,
`plugin_versions`, `plugin_dependencies`, `plugin_permissions`,
`plugin_permission_audit`, `plugin_install_history`, `plugin_settings`,
`plugin_kv`, `plugin_backups` and `plugin_meta`.

## Contributions and UI

A contribution is exposed only when the plugin is `running`, declares
`ui.contribute` in its permissions, and has that grant active
(`contributingEntries()` in the registry).

- `snapshot.navigation` is consumed by `AppSidebar` under **Plugin apps**.
  Entries link to `/plugin/<pluginId>?screen=<routeId>`.
- `/plugin/[pluginId]` is the shared declarative plugin-home renderer. It uses
  the selected route title, manifest description, `dashboardWidgets`,
  `settingsSchema`, declared permissions, and a dedicated health panel for the
  built-in diagnostics plugin.
- Toolbar and context action buttons are interactive only when the manifest
  has a `builtin` entry point and `events.listens` includes `plugin.action`.
  Pressing one emits `plugin.action` through `platform.events`.
- `snapshot.widgets` is rendered by the Today screen as link cards, and
  `snapshot.settingsSections` is rendered by app Settings as link cards. Both
  come from `contributingEntries()`, so disabled plugins and plugins without an
  active `ui.contribute` grant disappear immediately.
- `/plugin/[pluginId]` also renders the manifest's `dashboardWidgets` and
  `settingsSchema` directly.
- `getToolbarActions()` and `getContextActions()` are available on the
  registry but are not consumed as a global toolbar/menu.

## Tools, MCP and agent introspection

`PluginRegistry.registerTool()` accepts registrations only while a plugin is
`starting`/`running`, requires `ai.invoke` in the manifest and as an active
grant, validates the local tool name and parameters object, namespaces the
exposed name as `plugin__<slug>__<name>` (maximum 64 characters), and refuses a
name that already exists in the agent tool registry. Only reviewed built-in
implementations can supply the code that registers tools.

`buildPluginAgentTool()` checks on every call that the plugin is still running
and the required grants are active. It validates input with the conservative
JSON Schema subset, optionally asks for tool confirmation when the tool sets
`requiresApproval`, enforces a timeout clamped to 1–60 seconds (default 15 s),
observes cancellation, and rejects results over 200,000 characters.

MCP servers remain owned by `src/lib/mcp/registry.ts`. Each configured server
is mirrored as a synthetic `mcp.server.<slug>` plugin with `mcp.connect` and
`ai.invoke` grants. `mcpPluginAllowsTool()` blocks a server's tools unless that
synthetic plugin is `running` and both permissions are active. An explicit
revocation is sticky across re-sync.

`src/lib/cordis-tools.ts` registers three read-only agent tools:
`cordis_plugin_list`, `cordis_plugin_inspect` and
`cordis_plugin_permission_audit`. There are no agent tools to install plugins,
approve permissions, or execute plugin source.

## Legacy hook code

`src/lib/hooks.ts` no longer uses `new Function`. `HookEngine.runHookCode()`
always throws `Legacy hook code execution is disabled. Use a declarative plugin
instead.` Stored `hooks` rows are kept only for data compatibility and are
never compiled or evaluated. `executeHook()` records each failure as a failed
`HookExecution`. The AI agent still calls `executeHook('before_agent_turn', …)`
and other hook points, but it does not inspect the returned executions, so the
failed result is ignored by the caller.

## Current limitations

- Third-party plugins are declarative only. Executable
  `PluginImplementation` code is accepted only for reviewed `official` plugins
  with a `builtin` entry point and a registered module id.
- No downloaded JavaScript, remote plugin loader, or dynamic Cordis remount.
- Legacy hook scripts are disabled; stored hook rows never execute.
- `notifications` and `credentials` are typed in the SDK but the runtime passes
  no adapters, so those SDK calls throw. There is no SDK file API.
- `mcpTools` manifest declarations are metadata; execution belongs to configured
  MCP servers and is gated by the synthetic `mcp.server.*` integration.
- UI contributions are limited to the Orbit-owned screens described above.
- Plugin-specific Vitest files live under `src/lib/plugins/__tests__/`; this
  document does not assert their results.
