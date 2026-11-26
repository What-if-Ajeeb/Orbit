# Plugin developer guide

This guide covers what a plugin author can do with the code in this tree. It
describes implemented behavior only; it does not describe a remote marketplace
or downloaded code execution.

## Available plugin types

### Declarative plugins

Third-party plugins are manifests with no executable code. The canonical example
is `plugins/example-plugin/`:

- `manifest.json` — a version-1 manifest;
- `README.md` — user-facing install instructions.

A declarative plugin can contribute:

- a route rendered by `/plugin/<pluginId>?screen=<routeId>`;
- a sidebar entry under **Plugin apps** in `AppSidebar`;
- a settings form on the plugin-home screen built from `settingsSchema`;
- dashboard widget metadata rendered on the Today screen and on the
  plugin-home screen, plus settings sections rendered in app Settings;
- action buttons only when the plugin has a `builtin` entry point and declares
  `events.listens` containing `plugin.action`.

See [`PLUGIN_ARCHITECTURE.md`](PLUGIN_ARCHITECTURE.md#contributions-and-ui) for
the exact list of UI consumers.

### Built-in plugins

`builtin` entry points are reserved for reviewed `official` plugins. They can
supply a `PluginImplementation` with lifecycle hooks and SDK access. This tree
has `orbit-diagnostics` plus ten reviewed `orbit.builtin.*` native plugins that
wrap existing app services. No downloaded JavaScript is evaluated, and the
native plugin manifests are paired with host code only through
`NATIVE_PLUGIN_DEFINITIONS`.

When editing a native plugin:

1. Keep its manifest in `src/lib/plugins/native/` and add it to
   `NATIVE_PLUGIN_DEFINITIONS`; do not create a second runtime or registry.
2. Use `nativeTool()` for storage-scoped tools and `nativeHostTool()` otherwise.
   Return plain data and let the wrapper own JSON, redaction and logging.
3. Use `nativeOutputSchema()` so wrapper failures validate, and enforce
   least-privilege permissions plus `requiresApproval` for sensitive actions.
4. Wrap existing app services instead of duplicating them. Do not add code
   execution, arbitrary WebView routes, a second MCP transport or a new project
   store.
5. Add focused Vitest coverage under `src/lib/plugins/__tests__/` and run the
   full verification loop in [`OPERATIONS.md`](OPERATIONS.md).

### MCP integrations

Configured MCP servers are mirrored into synthetic `mcp.server.<slug>` plugins.
They are created from `mcp_servers` settings, not from third-party manifests.
Their tools remain registered by `src/lib/mcp/registry.ts` and are blocked unless
the synthetic integration is `running` with `mcp.connect` and `ai.invoke`
granted.

## Build a declarative plugin

1. Copy the structure of `plugins/example-plugin/`.
2. Give it a unique `pluginId` that does not use a reserved prefix
   (`orbit.core.`, `orbit.builtin.`, `orbit.mcp.`, `system.`, `core.`).
3. Set `manifestVersion: 1`, a valid semver `version`, author, publisher,
   description, platform support, and an `entryPoint` with `kind: 'declarative'`.
4. Declare only the permissions you need. Enable requires every declared
   permission to be granted; UI contributions require `ui.contribute`.
5. Declare matching capabilities. The registry rejects UI contributions without
   `ui.contribute`, events without an `events.publish`/`events.subscribe`
   capability, and `mcpTools` without `ai.invoke`.
6. Add `routes`, then optional `navigationEntries`, `dashboardWidgets`,
   `settingsSections`, `settingsSchema`, `toolbarActions`, `contextActions`,
   `events` (`emits`/`listens`), `mcpTools` and `lifecycleHooks`.
7. Validate the JSON shape against `docs/PLUGIN_MANIFEST.md` and
   `src/lib/plugins/manifest.ts`. Unknown top-level fields are errors.

Bundled manifests are registered in `src/lib/plugins/catalog.ts`. To make a new
manifest available in the app's Plugin Manager, add it there; there is no remote
catalog fetch in this build.

## Install and enable flow

1. Open **ORBIT → Plugins** and find the plugin under **Available**.
2. Press **Install**. Required catalog dependencies are installed automatically;
   incompatible platforms or app versions are refused. Optional dependencies are
   not auto-installed.
3. Press **Enable**. The approval host asks the user to grant missing declared
   permissions. Denying or timing out leaves the plugin disabled.
4. Once running, the plugin's navigation entry and plugin-home screen become
   available. Disabling or uninstalling removes contributions.

`usePluginActions()` wires the UI to the real registry calls. The UI does not
auto-approve permissions and has no "Approve all" control. Updates require
approval for added permissions and roll back on failure. Revoking a permission
stops an active plugin.

## Plugin Builder

**ORBIT → Plugins → Create Plugin** opens an in-app builder under the Plugins
screen; it is not a separate top-level destination. The guided flow has five
steps: **Basic Info**, **Configuration**, **Actions & Tools**, **Testing** and
**Save & Install**. **My Plugins** lists drafts and locally installed plugins.

Builder drafts are editor documents, not a second plugin format. They are
normalized on every load/save through `PluginPersistence.getMeta()`/`setMeta()`
and compiled to the same version-1 `PluginManifest` used by every other plugin.
Drafts can be saved, edited, duplicated, deleted, exported and marked locally as
ready for review. There is no automatic publishing.

Builder-authored plugins are strictly declarative and data-only:

- every action compiles to a fixed `SandboxProgramManifest` preset (`echo`,
  `sum`, `concat` or `constant`) interpreted by the isolated Android sandbox;
- no `PluginImplementation`, `PluginToolDefinition.execute`, `eval`,
  `new Function`, dynamic import, hook or host JavaScript is ever generated;
- editor-only fields (tags, presets, validation rules, error handling,
  environment references) never appear in the installed manifest and are never
  executed;
- environment entries are references only — secret values live in
  `expo-secure-store`, never in the draft, manifest or logs.

Installation asks for explicit approval and never auto-grants permissions.
Enabling uses the same approval host. Each Testing Playground run asks for fresh
approval and executes only through `createSandboxToolExecutor()`; on non-Android
platforms the sandbox fails closed. To install updated builder changes, increase
the draft version first. Revoke a permission or uninstall from **My Plugins** or
the plugin detail screen; drafts are retained after uninstall.

Implementation references: `src/lib/plugins/builder.ts`,
`src/lib/plugins/builder-store.ts`, `src/lib/plugins/builder-service.ts`,
`src/lib/plugins/permissions.ts`, `src/lib/sandbox/` and
`src/app/(app)/plugins/{builder,my-plugins}.tsx`.

## Tools from a plugin

For a reviewed built-in implementation, register tools through the narrow SDK
during enable/start:

```ts
const unregister = await sdk.tools.register(
  {
    name: 'echo',
    description: 'Echo a message',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    execute: async (args) => ({
      content: JSON.stringify({ echoed: args.text }),
      trace: 'Echoed a message',
    }),
  }
);
```

The manifest must declare `ai.invoke` and the user must have granted it. The
agent sees the tool as `plugin__<slug>__echo`. Input is schema-validated; output
`content` must be a string of at most 200,000 characters. An `outputSchema`,
per-call approval, cancellation and a 1–60 second timeout are supported. A
declarative manifest's `mcpTools` array does not register an agent tool by
itself.

## Storage, settings and events

SDK KV is per-plugin, JSON-only and capped at 1 MB. Keys and settings names
follow the patterns in `docs/PLUGIN_MANIFEST.md`. Settings values are validated
against `settingsSchema`; secret-looking setting keys are refused. The user can
edit declared settings in the plugin home screen via `PluginSettingsForm`.

Use `sdk.events.emit()` and `sdk.events.subscribe()` only for names declared in
`manifest.events.emits` and `manifest.events.listens`. Payloads are sanitized by
the event bus. There is no arbitrary event-name API and no `eventSubscriptions`
manifest field.

## Network, notifications and credentials

Use `sdk.network.fetch()` only after declaring and receiving `network.access`.
It allows absolute HTTPS URLs, string bodies and plain-object headers, with a
20-second timeout and a 512 KB response-text limit. `notifications` and
`credentials` are typed on the SDK but have no runtime adapters in this build;
calls throw. `files.read`/`files.write` are reserved declarations with no SDK
file API.

## Legacy hook scripts

Do not write hook scripts. `src/lib/hooks.ts` no longer uses `new Function`;
`runHookCode()` always throws `Legacy hook code execution is disabled. Use a
declarative plugin instead.` Stored hook rows are retained for data compatibility
and are never compiled or evaluated. `executeHook()` records the failure, and
the AI agent's calls (including `before_agent_turn`) ignore the failed result.

Manifest `lifecycleHooks` are declarations only. They run only when a reviewed
built-in implementation supplies the matching function.

## Limitations to keep in mind

- No third-party JavaScript execution, remote URL code loading or dynamic
  Cordis remounting.
- No remote marketplace, downloaded bundle or remote manifest fetch. A plugin
  can be discovered on demand only if it is already in the bundled trusted
  catalog or is an enabled MCP server configured by the user, and only after the
  native approval dialog.
- No `sdk.mcp`, `sdk.plugin.onStatus`, `sdk.ai.getContext()` or
  `sdk.tools.unregister(name)`.
- Notifications/credentials SDK adapters are not supplied; file permissions
  have no file API.
- Plugin-specific Vitest files exist under `src/lib/plugins/__tests__/`; this
  guide does not assert their results.

## Verification

For documentation-only changes, do not claim that tests passed. The repository
commands for plugin-related changes are listed in
[`docs/OPERATIONS.md`](OPERATIONS.md): typecheck, lint, Android export and the
Vitest suite that includes `src/lib/plugins/__tests__/`.
