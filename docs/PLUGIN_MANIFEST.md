# Plugin manifest (implementation reference)

This document describes the version-1 JSON manifest validated by
`validateManifest()` in `src/lib/plugins/manifest.ts` and normalized into
`PluginManifest` (`src/lib/plugins/types.ts`). The canonical example is
`plugins/example-plugin/manifest.json`.

Validation is strict about unknown **top-level** fields: any key outside the
allowed list is an error, except `$schema`, which is ignored. Nested objects
are read field by field; extra nested keys are not rejected by the validator.
The validator returns `{ ok, manifest?, errors, warnings }`.

## Required fields

| Field | Type | Rules |
| --- | --- | --- |
| `pluginId` | string | `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`; max 128 chars. Lowercase, starts with a letter, dot/dash separated. |
| `name` | string | 1–120 characters after trimming. |
| `version` | string | Valid semver `MAJOR.MINOR.PATCH`, optional prerelease/build metadata. |
| `description` | string | 1–4000 characters after trimming. |
| `author` | object | `name` required (1–120 chars); optional `url` string. |
| `publisher` | object | `id` valid lowercase plugin-id pattern; `name` required; `verified` must be a boolean. |
| `category` | string | One of `ui`, `service`, `tool`, `mcp`, `ai`, `storage`, `automation`, `provider`, `integration`, `background`. |
| `minimumOrbitVersion` | string | Valid semver. Used by the registry with `>=`. |
| `platformSupport` | string[] | Non-empty subset of `android`, `ios`, `web`; duplicates rejected. |
| `entryPoint` | object | See [Entry points](#entry-points). |

`manifestVersion` is accepted but optional: when omitted the validator warns
and defaults to `PLUGIN_MANIFEST_VERSION` (`1`). A present value must be a
positive integer no greater than `1`.

## Optional top-level fields

- `icon` — non-empty string up to 160 chars. Interpreted as an Ionicons glyph
  name by the app; never evaluated.
- `dataSchemaVersion` — non-negative integer, default `1`.
- `updatePolicy` — one of `manual`, `notify`, `auto-safe`, default `manual`.
  These are metadata; there is no remote update mechanism in this build.

Arrays that default to empty when omitted: `permissions`, `capabilities`,
`dependencies`, `optionalDependencies`, `routes`, `navigationEntries`,
`dashboardWidgets`, `settingsSections`, `settingsSchema`, `toolbarActions`,
`contextActions`, `mcpTools`, `lifecycleHooks`, and the `emits`/`listens` lists
inside `events`.

There is no manifest field for `readme`, `screenshots`, `maximumOrbitVersion`,
`homepage`, `repository`, `license`, or `keywords`. Catalog readme/screenshots
are supplied out of band by `registerCatalog()`.

## Entry points

`entryPoint.kind` must be one of `builtin`, `declarative`, or `mcp`.

- `declarative` — the third-party path. `screen` may be omitted; if present it
  must equal `"plugin-home"`. The manifest is rendered by Orbit's own screens;
  no plugin code is executed.
- `builtin` — requires `moduleId` matching `^[a-z][a-z0-9-]*$` (max 120 chars).
  `isEntryPointAllowed()` permits this kind only for `official` trust. The
  module id must match a key in `BUILTIN_IMPLEMENTATIONS`; currently only
  `orbit-diagnostics` is present.
- `mcp` — optional `serverId` string. Used by synthetic MCP integration
  records, not by third-party manifests.

Reserved id prefixes (`orbit.core.`, `orbit.builtin.`, `orbit.mcp.`, `system.`,
`core.`) require `official` trust. This is checked by `isEntryPointAllowed()`
in the registry during `discover()`, `adopt()` and `update()`, not by the
manifest shape validator itself.

## Permissions

`permissions` is an array of valid values; duplicates are rejected. There must
be at least one active grant for every declared permission before a plugin can
enable. Declaring a permission does not grant it.

| Group | Values |
| --- | --- |
| Network | `network.access` |
| Storage | `storage.read`, `storage.write` |
| Reserved file declarations | `files.read`, `files.write` |
| Device/OS | `notifications.send`, `camera.access`, `microphone.access`, `location.access`, `contacts.read`, `calendar.read`, `calendar.write`, `clipboard.read`, `clipboard.write`, `background.execute` |
| AI/MCP | `ai.invoke`, `ai.context.read`, `mcp.connect` |
| Sandbox | `sandbox.execute` |
| Credentials | `credentials.request` |
| UI | `ui.contribute` |

`files.read` and `files.write` are accepted but produce a validation warning:
the SDK has no file API. `camera.access`, `microphone.access`, `location.access`,
contacts, calendar, clipboard and background execution are valid declarations
with no corresponding SDK implementation in this tree. `sandbox.execute` is used
by the host-owned Android mobile sandbox approval path; see
[`MOBILE_SANDBOX.md`](MOBILE_SANDBOX.md). Declaring it does not grant it.

## Capabilities

`capabilities` is an array of valid values; duplicates are rejected. Valid
values:

`ui.screens`, `ui.navigation`, `ui.widgets`, `ui.settings`, `ui.toolbar`,
`ui.context-menu`, `tools.ai`, `tools.mcp`, `provider.llm`,
`storage.namespaced`, `events.publish`, `events.subscribe`,
`automation.triggers`, `background.tasks`, `integration.mcp`, `ai.context`.

Capabilities are metadata. The registry applies these additional contribution
policies during discovery/adoption/update:

- Any UI contribution requires `ui.contribute` in `permissions`.
- Declared `events.emits` or `events.listens` require `events.publish` or
  `events.subscribe`.
- `mcpTools` require `ai.invoke`.
- A `declarative` plugin cannot have executable implementation code registered
  for its id.

## Dependencies

`dependencies` and `optionalDependencies` are arrays of
`{ pluginId, version }`. `pluginId` must be valid and cannot be the plugin's
own id. `version` is a semantic-version range. Duplicates within a single
array are rejected; cycles are rejected by the registry.

Supported range syntax: exact versions, `=1.2.3`, `^1.2.3`, `~1.2.3`,
`>=1.0.0`, `>1.0.0`, `<=2.0.0`, `<2.0.0`, `1.2.x`, `1.x`, `*`,
space-separated conjunctions, and `||` alternatives.

Required dependencies must be installed and active before enable; optional
dependencies must satisfy their range only if they are installed.

## Contributions

`routes` entries are `{ id, screen, title }`. `id` matches
`^[a-z][a-z0-9-]*$`, `screen` must be `"plugin-home"`, and `title` is required.
Ids must be unique.

`navigationEntries` are `{ id, label, icon, routeId, order? }`. `label` and
`icon` are required strings; `routeId` must reference a declared route; `order`
must be finite when present.

`dashboardWidgets` are `{ id, title, description, size? }`. `size` may be
`small`, `medium`, or `large`.

`settingsSections` are `{ id, title, description? }`.

`toolbarActions` are `{ id, label, icon, event }`, where `event` matches the
event-name pattern. `contextActions` add `context: 'plugin-home' | 'sidebar'`.

`settingsSchema` fields have a unique `key` matching
`^[A-Za-z][A-Za-z0-9._-]*$`, a `label`, and one of these types:

- `string` — optional string `default`, `description`, `required`.
- `number` — optional finite `minimum`, `maximum`, numeric `default`.
- `boolean` — optional boolean `default`.
- `select` — non-empty `options` array of `{ value, label }`; `default`, if
  present, must match an option.

`mcpTools` entries are `{ name, description, inputSchema?, outputSchema? }`.
`name` matches `^[A-Za-z][A-Za-z0-9_-]{0,63}$`; `description` is required;
schemas must be objects when present. These declarations are metadata only.

`events` is `{ emits: string[], listens: string[] }`. Names match
`^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`; duplicates are rejected. There is no
`eventSubscriptions` field. `lifecycleHooks` is an array of `onInstall`,
`onInitialize`, `onStart`, `onStop`, `onEnable`, `onDisable`, `onUpdate`,
`onUninstall`, `onError`; duplicates are rejected. Declared hooks run only when
a reviewed built-in implementation supplies the corresponding function. Legacy
rows in the old `hooks` table are never compiled or evaluated.

## Warnings

Non-blocking warnings are produced for:

- a missing `manifestVersion` (defaulted to `1`);
- `ui.navigation` declared without any `navigationEntries`;
- `files.read` or `files.write` permissions.

Errors must be resolved before the manifest can be discovered, cataloged,
adopted, or used as an update.
