# Plugin security model

This document describes the controls implemented by the plugin platform in this
tree. It is runtime behavior, not a claim of a formal security audit.

## No downloaded executable code

Third-party plugins are declarative manifests. `entryPoint.kind` may be
`builtin`, `declarative`, or `mcp`. A `builtin` entry point requires
`trustLevel: 'official'`, a `moduleId`, and a reviewed module in
`BUILTIN_IMPLEMENTATIONS`; only `orbit-diagnostics` is present. The platform has
no JavaScript loader, no remote plugin code fetch, and no dynamic Cordis
remount.

The five Cordis spine plugins (`orbit.core.session`, `orbit.core.tools`,
`orbit.core.llm`, `orbit.core.mcp`, `orbit.core.agent`) are already mounted by
the existing harness. The platform adopts them as metadata records; it does not
mount or execute them again.

## Legacy hook scripts are disabled

`src/lib/hooks.ts` no longer uses `new Function`. `HookEngine.runHookCode()`
always throws:

```text
Legacy hook code execution is disabled. Use a declarative plugin instead.
```

Stored `hooks` rows are kept only for data compatibility. They are never
compiled or evaluated. `executeHook()` records each failure as a failed
`HookExecution`; the AI agent still calls `executeHook('before_agent_turn', …)`
and other hook points, but it does not inspect those executions, so the failed
result is ignored by the caller. Do not treat stored hook scripts as working
extensions.

## Default-deny permissions

`PluginPermissionManager` starts with no grants. Every check requires an active
grant for that exact plugin and permission. Trust level, publisher verification,
catalog membership and source do not imply a grant.

Grant sources are `user`, `core`, `mcp_settings` and `migration`:

- `user` — approved through `PluginApprovalHost`.
- `core` — used once by bootstrap for the built-in diagnostics plugin's
  `ui.contribute` permission.
- `mcp_settings` — used when configured MCP servers are mirrored into synthetic
  plugins. An explicit user revocation is not re-granted on later syncs.
- `migration` — a valid persisted source type; the current legacy importer does
  not import legacy permission grants.

Granting, denying and revoking write audit events to
`plugin_permission_audit`. Missing required permissions throw
`MissingPluginPermissionsError` during enable and block contributions and tool
execution. Revoking a permission stops an active plugin.

## Approval UI

`src/components/plugins/PluginApprovalHost.tsx` is the global modal surface for
permission requests and sensitive plugin tools. Requests come from the
host-neutral queue in `src/lib/plugins/approvals.ts`:

- one modal is shown at a time; later requests are queued;
- **Allow** or **Deny** resolves only the pending request;
- each request defaults to deny after 120 seconds;
- the service has a `denyAll()` method, but the current `PluginApprovalHost`
  does not call it on unmount; pending requests therefore expire by timeout
  instead of being rejected immediately;
- there is no "Approve all" control.

`usePluginActions()` in the Plugin Manager routes install-time/enable-time and
update-time permission requests through this host. The UI does not auto-approve
user-facing grants.

## Tool execution boundaries

Plugin tools are registered only while a plugin is `starting`/`running`, and
only if the manifest declares `ai.invoke` and the grant is active. The exposed
name is `plugin__<slug>__<name>` and collisions with existing agent tools are
rejected. `buildPluginAgentTool()` in `src/lib/plugins/tools.ts` enforces:

- the plugin must still be `running` and the grant still active on every call;
- input arguments must pass the conservative JSON Schema subset validator;
- `content` must be a string of at most 200,000 characters and `trace` a string;
- an optional `outputSchema` is validated after parsing `content` as JSON;
- optional per-tool approval and cancellation;
- a timeout clamped to 1–60 seconds (default 15 s).

`cordis_plugin_list`, `cordis_plugin_inspect` and
`cordis_plugin_permission_audit` in `src/lib/cordis-tools.ts` are read-only.
There are no agent tools that install plugins, approve permissions or execute
plugin code.

MCP execution remains under `src/lib/mcp/registry.ts`. Each configured server
is mirrored as a synthetic `mcp.server.<slug>` plugin. The plugin runtime
installs `mcpPluginAllowsTool()` as the gate in its constructor, so MCP tools are
default-denied from the moment the platform object exists, before bootstrap and
MCP sync. A tool is allowed only while the synthetic plugin is `running` and both
`mcp.connect` and `ai.invoke` are active. An explicit revocation is sticky
across re-sync.

## SDK containment

`createPluginSdk()` passes only the adapter object documented in
[`PLUGIN_SDK.md`](PLUGIN_SDK.md). It does not pass the SQLite handle, Cordis
context, full app state, raw `fetch`, router, `process`, `globalThis` or any code
loader. Plugin storage is namespaced and capped at 1 MB; settings are validated
against the manifest schema; event payloads are sanitized and size-limited.

`network.fetch` requires `network.access`, an absolute HTTPS URL, a 20-second
timeout and a string body. Response text is sliced to 512 KB. It does not
attach credentials automatically. `notifications` and `credentials` are typed
but the runtime supplies no adapters, so those calls throw an explicit
unavailable error. `files.read`/`files.write` are reserved declarations with no
SDK file API.

## Lifecycle, hooks and timeouts

Plugin lifecycle hooks run only when a reviewed built-in implementation supplies
the corresponding function. `withTimeout()` in `src/lib/plugins/async.ts` uses a
hard timeout (5,000 ms for normal hooks, 2,000 ms for `onError`) and rejects
even if the underlying implementation ignores aborts. Failures record error and
health state, emit `plugin.error`, and abort the operation except where shutdown
paths tolerate failure.

`update()` snapshots settings and KV before replacing a manifest, requires
approval for added permissions, and restores manifest, permissions and data on
failure. `uninstall()` refuses when another installed plugin depends on it.
Disabling unregisters tools and disposes event subscriptions.

## Persistence boundaries

Only `SqlitePluginPersistence` touches plugin-specific tables, created by the
v12 migration in `src/lib/db.ts`: `plugin_records`, `plugin_versions`,
`plugin_dependencies`, `plugin_permissions`, `plugin_permission_audit`,
`plugin_install_history`, `plugin_settings`, `plugin_kv`, `plugin_backups` and
`plugin_meta`. Legacy rows from the old `plugins` table are imported once as
disabled, untrusted declarative records; legacy executable code is never loaded.

## Current limitations

- This is application-level containment for declarative plugins, not a sandbox
  around arbitrary native or JavaScript code.
- Triple-dot identifiers are namespaces, not verified publisher identities.
- `publisher.verified` is advisory metadata. Trust levels do not grant
  permissions, but they do gate which entry-point kinds and plugin ids may be
  registered.
- `events.emits` and `events.listens` constrain SDK event use; there is no
  arbitrary event-name API.
- UI contributions are limited to Orbit-owned renderers; there is no
  declarative view DSL or remote renderer.
- Legacy hook scripts are disabled and must not be used as an extension path.
- Plugin-specific Vitest files exist under `src/lib/plugins/__tests__/`; no
  test results are asserted in this document.
