# Plugin platform migration notes

This document records migration behavior implemented in this tree. It is not a
plan for future releases.

## Database schema

The v12 migration in `src/lib/db.ts` creates `plugin_records`,
`plugin_versions`, `plugin_dependencies`, `plugin_permissions`,
`plugin_permission_audit`, `plugin_install_history`, `plugin_settings`,
`plugin_kv`, `plugin_backups` and `plugin_meta`. The older `plugins` and
`overlays` tables are left in place.

## From legacy `plugins` rows

At bootstrap, `PluginPlatformRuntime.migrateLegacyPlugins()` reads rows from the
old `PluginStore`. Each row is adopted once as:

- `pluginId: legacy.local.plugin-<id>`;
- `version: 0.0.0`;
- a declarative, disabled record with `trustLevel: 'untrusted'`,
  `source: 'legacy'` and `legacy: true`;
- a synthesized manifest with no permissions, capabilities, routes or other
  contributions.

No legacy executable code or overlay is loaded. No legacy permission grants are
imported by this path. The original rows remain untouched so older builds can
still read them. A `plugin_meta` marker named `legacy.plugins.migrated.v1`
stores the number of legacy rows seen.

## Adoption of Cordis core plugins

The five vendored Cordis spine plugins are registered as bundled catalog
manifests and adopted at bootstrap as `official`/`builtin` records with status
`running` and `enabled = true`:

- `orbit.core.session`
- `orbit.core.tools`
- `orbit.core.llm`
- `orbit.core.mcp`
- `orbit.core.agent`

These manifests give the Plugin Manager and agent tools a read-only view of
services the existing harness already mounts. The platform does not mount or
execute them again. Their `moduleId` values are metadata; they do not receive
native implementations. Reviewed implementations exist only for
`orbit-diagnostics` and the ten `orbit.builtin.*` native plugins.

## MCP servers as plugins

Configured MCP servers are mirrored into synthetic integration plugins with ids
like `mcp.server.<slug>`, built by `mcpPluginId()`. `syncMcpPluginRecords()`:

- creates or updates a record from the server name, URL and enabled state;
- grants `mcp.connect` and `ai.invoke` with source `mcp_settings` the first time
  the server is seen;
- refuses to re-grant a permission the user explicitly revoked;
- sets the record to `running` only when the server is enabled, has a URL and no
  required permission was revoked;
- disables a previously running synthetic record when its server no longer
  exists.

`mcpPluginAllowsTool()` is installed as the MCP tool gate in the
`PluginPlatformRuntime` constructor, so tools are default-denied before bootstrap
and MCP sync complete. A tool is allowed only while the synthetic integration is
`running` and both permissions are active. Revocations are sticky across syncs.

## Built-in diagnostics

The built-in diagnostics plugin is registered from `builtins.ts` and
installed/enabled once during bootstrap. Its `ui.contribute` permission is
granted with source `core`. The ten `orbit.builtin.*` native plugins are
registered from `native/` and installed/enabled once on supported platforms by
`ensureNativePlugins()`; their declared permissions also use source `core`, but
sensitive tool calls still require fresh per-call approval. Diagnostics is the
only `BUILTIN_IMPLEMENTATIONS` entry; native plugins use
`registerNativePluginImplementations()`.

## Updates and backups

`PluginRegistry.update()` requires a strictly greater semver version and the
same `pluginId`. Before applying a new manifest it writes a settings/KV snapshot
to `plugin_backups`. Added permissions require approval through
`PluginApprovalHost`; removed permissions are revoked. If any step fails, the
previous manifest, permission changes and data are restored, and a running
plugin is re-enabled when possible. The implementation does not delete backup
rows after a successful update.

## Incomplete installs and restarts

`restore()` validates each stored manifest. Records in `installing`, `updating`
or `uninstalling` are forced to `disabled`, as are records found in an active
state (`enabled`, `starting`, `running`). A record that was both `enabled` and
active is returned as resumable. Bootstrap re-enables resumable ids in dependency
order, with a sorted fallback if ordering fails. Disabled and error records are
not auto-resumed.

## Legacy hook scripts

Hook rows in the old `hooks` table are data only. `src/lib/hooks.ts` no longer
uses `new Function`; `runHookCode()` always throws `Legacy hook code execution
is disabled. Use a declarative plugin instead.` `executeHook()` records each
failed execution, but the AI agent does not inspect the returned executions, so
calls such as `executeHook('before_agent_turn', …)` are recorded and ignored.
No hook script behavior is migrated or executed.

## What is not migrated

- No legacy executable plugin code, overlay or hook script is imported.
- No legacy permission grants are imported from old rows.
- No remote catalog entries, marketplace subscriptions or downloaded plugin
  bundles are migrated. On-demand discovery searches only the bundled trusted
  catalog and configured MCP servers; it never imports legacy or unknown
  manifests.
- No declarative third-party plugin from `plugins/` is auto-installed; it must
  be in the bundled catalog and installed through the UI.
- Legacy `plugins` rows themselves are not deleted.

Plugin-specific Vitest files exist under `src/lib/plugins/__tests__/`. This
document describes migration code only; it does not assert test results.
