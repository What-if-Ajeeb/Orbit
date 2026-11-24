# Hello Orbit — declarative example plugin

This folder is the third-party plugin template for ORBIT Plugin Platform 2.0.

It contains **no executable code**. The manifest declares a route, a sidebar
entry, a dashboard widget, a settings section and an ordinary settings form.
ORBIT validates the manifest, asks the user to approve the declared permissions
and renders the approved contributions through its own screens.

```text
plugins/example-plugin/
├── manifest.json   ← canonical plugin manifest
└── README.md       ← this file
```

## Install and enable

1. Open **ORBIT → Plugins**.
2. Find **Hello Orbit** under **Available**.
3. Install it. It requests `ui.contribute`, plugin storage and notifications.
4. Enable it and approve the permissions.
5. A **Hello Orbit** entry appears in the sidebar, a widget appears on Today
   and a settings section appears in Settings.

Disabling or uninstalling the plugin removes every contribution immediately.

## Why there is no JavaScript here

ORBIT does not execute downloaded JavaScript inside the application. Third-party
plugins are declarative by design: manifests, settings schemas and typed
contributions. Native code is reserved for reviewed built-in plugins
(`trustLevel: official`). See `docs/PLUGIN_SECURITY.md` for the full trust
model.

## Next steps

- Read `docs/PLUGIN_MANIFEST.md` for every supported manifest field.
- Read `docs/PLUGIN_DEVELOPER_GUIDE.md` to add a built-in plugin with an SDK
  implementation.
- Run `npx vitest run src/lib/plugins` after changing the manifest.
