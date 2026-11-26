# Plugin security model

This document describes the controls implemented by the plugin platform in this
tree. It is runtime behavior, not a claim of a formal security audit.

## No downloaded executable code

Third-party plugins are declarative manifests. `entryPoint.kind` may be
`builtin`, `declarative`, or `mcp`. A `builtin` entry point requires
`trustLevel: 'official'`, a `moduleId`, and reviewed host code registered through
`BUILTIN_IMPLEMENTATIONS` or `registerNativePluginImplementations()`. This tree
contains diagnostics plus ten `orbit.builtin.*` native plugins. The platform has
no JavaScript loader, no remote plugin code fetch, and no dynamic Cordis remount.

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
- `core` — used by bootstrap for the built-in diagnostics plugin's
  `ui.contribute` permission and for permissions declared by the reviewed native
  plugins. Per-call approval still applies to sensitive tool actions.
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
- each request defaults to deny after 120 seconds, an `AbortSignal`, or unmount;
- a request id is passed to the caller and shown in the install dialog;
- the service has a `denyAll()` method, but the current `PluginApprovalHost`
  does not call it on unmount; pending requests therefore expire by timeout
  instead of being rejected immediately;
- there is no "Approve all" control.

`usePluginActions()` in the Plugin Manager routes install-time/enable-time and
update-time permission requests through this host. The UI does not auto-approve
user-facing grants.

The same queue handles `kind: 'install'` requests from the demand resolver. The
modal shows the capability reason, a read-only inspection (exact plugin id,
version, publisher and verification, registry, compatibility, ORBIT minimum,
dependency states and warnings), planned steps, required dependencies, sensitive
permissions and sandbox warning. The action is **Install & grant** or
**Update & grant**; **Deny**, cancellation, timeout or unmount leaves the plugin
untouched. There is no bulk approval.

Every agent tool call also passes through one monotonic pipeline in
`src/lib/permissions/executor.ts`: classify → authorize → pre-execute checks →
guard → execute → post-execute → finalize. A denial cannot be reversed, a
consumed one-time grant cannot authorize another run, and the pipeline snapshot
is written to both the tool result and the permission audit. Tool bodies get one
`AbortSignal` and one cooperative timer; a declared `timeoutMs` is clamped and
otherwise falls back to the category default. A limit returns structured
`TOOL_TIMEOUT` / `TOOL_CANCELLED` and records a failed execution.

## Demand installation boundaries

`src/lib/plugins/demand.ts` never downloads code or manifests. It searches only
the bundled trusted catalog (verified `official`/`verified` publishers) and
enabled, user-configured MCP servers. A candidate must pass `validateManifest()`,
compatibility checks, dependency version checks, and an entry-point trust check
before it can reach the approval queue. `orbit_plugin_request` cannot bypass that
queue: the install/update/enable and scoped permission grant happen only after a
`true` approval result.

Both agent tools are scoped in `secureExecuteTool()` through the existing
Permission Manager. Discovery is read-only; requesting is marked as
approval-gated and delegates the real decision to the plugin approval dialog.
Successful activations grant only the exact `plugin__`/`mcp__` tools that the
approved plugin registered, and `runAgent()` recomputes the tool list for the
next round. If the approved plugin contributes no tool, the result says so.

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
`orbit_plugin_discover` and `orbit_plugin_request` do not install, approve or
execute anything directly; a request is only a proposal to the user-gated plugin
approval surface. No agent tool can grant a permission or execute plugin code
without that surface and the runtime's per-call checks.

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

## Android mobile sandbox (Android only)

The separate [`MOBILE_SANDBOX.md`](MOBILE_SANDBOX.md) subsystem adds an Android-only
process boundary for **data-only deterministic programs**, not arbitrary plugin
code. A local Expo Module binds an `android:isolatedProcess="true"` service. Rust in
that service validates the manifest and interprets a fixed instruction set; it has
no file, network, permission, JavaScript, or native-code APIs. Kotlin only performs
binding, message correlation, and timeouts.

Every run requires an explicit `sandbox.execute` approval through
`PluginApprovalHost` with `trustLevel: 'untrusted'`. A denial, timeout, missing
native library, bind failure, or panic fails closed. The existing plugin platform
still never loads downloaded JavaScript or legacy hook code.

A reviewed built-in tool may supply a data-only `program` on its
`PluginToolDefinition`. The sandbox is then the tool body: the same registry,
namespacing, schema checks, timeouts and permission assertions still apply, and
only the execution of the tool body moves into the isolated process. The
diagnostics plugin's `sandbox_echo` tool is the small reference implementation;
`orbit.builtin.sandbox` exposes `sandbox_policy` and `sandbox_compute` with fixed,
reviewed instruction sequences and rejects raw instructions. There is no
`sandbox` manifest entry kind and no dynamic code loader. MCP tools keep their
host-side network bridge because the Rust core has no network API.

This is a process boundary plus a bounded interpreter. It is **not** a claim of
complete isolation from the Android kernel, Binder, or a device compromise, and it
must not be used to justify running arbitrary third-party native or JavaScript code.

## Native plugin boundaries

The ten `orbit.builtin.*` plugins are bundled, reviewed code, not extension
points for user-supplied programs. They reuse the canonical registry, stores and
approval host:

- Agent is read-only introspection and does not change agent settings or grants.
- Files exposes only user-scoped artifact operations and trash metadata; it never
  returns raw filesystem paths.
- Browser hands approved `http`, `https` and `mailto` links to the OS; it has no
  fetcher, automation API, or arbitrary-URL WebView.
- Code is an education-only tutor that sends explanations to the configured AI
  provider through the existing adapter registry. It has only `ai.invoke`, reads
  no files, and has no editor, execution, shell, scaffolding or sandbox-coding
  tool. Code snippets are illustrative text, not programs run by ORBIT.
- Tasks, Projects and Buddy reuse their existing app stores. Tasks does not
  duplicate reminder sync or buddy rewards, Projects has no separate CRUD store,
  and Buddy reads do not create a starter buddy.
- MCP is read-only introspection plus an approved re-sync of the existing mirror;
  it does not add a transport, tool gate or synthetic plugin store.
- Sandbox is Android-only and data-only. Its manifest does not support iOS/web,
  and unavailable security checks fail closed.

## Plugin Builder

The in-app builder does not introduce a second runtime, registry, permission
manager, event bus or persistence layer. It compiles editor drafts into the same
version-1 manifests validated by `validateManifest()` and drives the canonical
registry and approval host.

- Drafts are normalized on every load and save. Unknown fields, unsupported
  enums, reserved ids and secret values are dropped or rejected before the data
  reaches any runtime seam.
- Builder actions compile only to fixed sandbox presets. The generated tool
  definitions never contain `execute`, host callbacks or code strings; a
  defensive check in `registerBuilderTools()` refuses any definition that
  unexpectedly contains host code.
- Install, enable and playground test each require explicit approval. No grant
  is auto-approved, and the playground approval is never persisted as a grant.
- Secret environment entries are references only. Values are written with
  `expo-secure-store` (`WHEN_UNLOCKED`) and are never stored in drafts, manifests
  or logs. Error strings and execution logs pass through the existing secret
  redaction helper.
- Marketplace preparation is local only: a validated draft can be marked ready
  for review and exported, but the builder never publishes, submits or promotes
  a plugin.
- The five core Cordis plugins remain managed by the harness and cannot be
  disabled, uninstalled or replaced through builder flows.

## Current limitations

- Plugin containment is application-level for declarative plugins, not a sandbox
  around arbitrary native or JavaScript code. The Android mobile sandbox is a
  bounded, data-only execution path for tools that explicitly declare a program.
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
