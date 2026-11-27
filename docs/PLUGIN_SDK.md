# Plugin SDK surface

`createPluginSdk()` in `src/lib/plugins/sdk.ts` creates the only object passed to
a reviewed built-in plugin implementation. Third-party plugins are declarative
and do not import or receive this SDK. The runtime passes a narrow adapter; it
does not pass the database, Cordis context, app state, raw `fetch`, router,
`process`, `globalThis` or a code loader.

`BUILTIN_IMPLEMENTATIONS['orbit-diagnostics']` and the reviewed native plugin
definitions in `src/lib/plugins/native/` are the only sources of implementation
code in this tree. `definePlugin(manifest, implementation)` is a helper for
keeping a built-in manifest and implementation together; native plugins use
`NATIVE_PLUGIN_DEFINITIONS` and `registerNativePluginImplementations()` instead.

## Identity and permissions

- `sdk.pluginId` and `sdk.version` are read-only values from the manifest.
- `sdk.manifest` is the validated manifest object; treat it as read-only.
- `sdk.permissions.list()` returns active grants for this plugin.
- `sdk.permissions.has(permission)` checks one active grant.
- `sdk.permissions.request(permissions, reason)` checks that every requested
  permission is declared in the manifest, asks the approval host, and records a
  `user` grant only when approved. It returns a boolean.

Declaring a permission never grants it. Extra permissions not in the manifest
cannot be requested through the SDK.

## Logging and diagnostics

- `sdk.logger` has `debug`, `info`, `warn` and `error` methods.
- `sdk.diagnostics.log` is an alias of `sdk.logger.info`.
- Messages are prefixed with `[plugin:<pluginId>]`. Obvious bearer tokens and
  `token=`/`key=`/`secret=`/`password=` values are redacted before logging.
- `sdk.diagnostics.status()` returns the current lifecycle status.
- `sdk.diagnostics.health()` returns the stored `PluginHealth` record or `null`.

There is no per-level/per-message rate limiter in the implementation.

## Storage

- `sdk.storage.get(key)` returns parsed JSON or `null`.
- `sdk.storage.set(key, value)` writes JSON-serializable data.
- `sdk.storage.delete(key)` removes one key.
- `sdk.storage.list()` returns `{ key, bytes, updatedAt }` metadata.
- `sdk.storage.usage()` returns `{ bytes, limit }`; the limit is 1 MB.

Keys must match `^[A-Za-z0-9][A-Za-z0-9._:-]*$` and be at most 128 characters.
`get`, `list` and `usage` require an active `storage.read` grant; `set` and
`delete` require `storage.write`. Values are stored per plugin.

## Settings

- `sdk.settings.all()` returns stored values with manifest defaults applied.
- `sdk.settings.get(key)` returns one value or `null`.
- `sdk.settings.set(key, value)` requires `storage.write` and validates the key
  and value against the matching `settingsSchema` field.
- `sdk.settings.delete(key)` requires `storage.write` and removes the stored
  override.

`registry.setSetting()` refuses secret-looking keys and undeclared keys. The
same validation path is used by `PluginSettingsForm` on the plugin-home screen.
Settings are ordinary data, not a credential store.

## Events

- `sdk.events.subscribe(event, handler)` requires `event` to appear in
  `manifest.events.listens`; it returns an unsubscribe function.
- `sdk.events.emit(event, payload)` requires `event` to appear in
  `manifest.events.emits`.

Event names are the typed keys of `OrbitEventMap`: plugin lifecycle, permission,
tool and action events, plus `user.authenticated`, `user.signedOut`,
`task.created`, `task.completed`, `mcp.connected`, `mcp.disconnected`,
`theme.changed`, `app.backgrounded` and `app.foregrounded`. `PluginEventBus`
redacts secret-looking payload keys, truncates long strings/arrays, limits
listeners per plugin, and guards recursive dispatch. `sdk.dispose()` calls all
subscription disposers and clears that plugin's listeners.

## Tools

- `sdk.tools.register(definition)` registers a tool and returns an unregister
  function.
- `sdk.ai.registerTool(definition)` is an alias of `sdk.tools.register`.

A `PluginToolDefinition` has `name`, `description`, `parameters` (a JSON Schema
object), optional `outputSchema`, `permissions`, `requiresApproval`, `timeoutMs`,
and either `execute(args, context)` or a data-only `program`. `execute` and
`program` are mutually exclusive in practice: when `program` is set, the tool body
runs in the Android sandbox and `execute` is omitted. Both resolve to
`{ content: string, trace: string }`.

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

There are no sandbox-backed tool bodies. Tool definitions cannot declare a
`program`, `instructions`, `handler` or `execute` string, and the registry
rejects program-only tools. The reviewed Android sandbox plugin exposes
security tools such as `sandbox_policy`, `sandbox_validate_manifest`,
`sandbox_validate_network` and the reviewed `sandbox_read_file`; sensitive
operations require a fresh resource-bound approval and are enforced by Rust plus
the Kotlin platform boundary. See
[`MOBILE_SANDBOX.md`](MOBILE_SANDBOX.md).

Registration requires `starting`/`running` status, `ai.invoke` in the manifest,
and an active `ai.invoke` grant. Extra tool permissions must also be declared
and granted. The exposed name is `plugin__<slug>__<name>`, limited to 64
characters; collisions with existing agent tools are rejected. Per-call checks
enforce running status, active grants, input validation, optional approval,
cancellation, a 1–60 second timeout (default 15 s), output shape, optional
output schema validation, and a 200,000-character `content` limit.

There is no `sdk.tools.unregister(name)` method; use the function returned by
`register()`.

## Network

`sdk.network.fetch(url, init)` requires an active `network.access` grant. The URL
must be absolute HTTPS. `init` may set a string `body`, plain-object `headers`,
and a method of `GET`, `POST`, `PUT`, `PATCH` or `DELETE` (default `GET`). It uses
a 20-second abort timeout and returns
`{ ok, status, text, headers }`. Response text is sliced to 512 KB. Credentials
are not attached automatically.

## Notifications and credentials

These properties are typed on `OrbitPluginSdk`, but the runtime passes no
adapters. Every method first checks its declared permission
(`notifications.send` or `credentials.request`) and then throws an explicit
"unavailable in this runtime" error. Declaring the permission does not change
that.

## Navigation

`sdk.navigation.entries()` returns a shallow copy of the manifest's
`navigationEntries`. It does not register or render new screens.

## Disposal

`sdk.dispose()` invokes tracked event unsubscribers and clears the plugin's
event listeners. It does not delete settings or KV data.

## Not exposed

- No `sdk.mcp`, `sdk.plugin` status object, `sdk.plugin.onStatus`, or
  `sdk.ai.getContext()`.
- No SQLite handle, direct table access, Cordis context or app state.
- No credential manager, keychain, filesystem or raw `fetch`.
- No JavaScript loader, `require`, `import()`, `process` or `globalThis`.
- No arbitrary native UI renderer; contributions come from the manifest and
  Orbit-owned screens.

Plugin-specific Vitest files live under `src/lib/plugins/__tests__/`. This page
describes the implementation only; it does not assert test results.
