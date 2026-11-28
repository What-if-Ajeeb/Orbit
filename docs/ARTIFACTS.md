# Artifacts

Artifacts are local, self-contained files the agent creates for the user. They
are stored in SQLite, versioned, previewed in a locked-down WebView, editable,
and exported through the native share sheet. They never rely on `localStorage`,
`fetch`, or a remote renderer.

## Interactive state

HTML artifacts can persist state through a small promise-based bridge:

```js
const tasks = await window.orbit.storage.get('tasks'); // string | null
await window.orbit.storage.set('tasks', JSON.stringify(tasks));
await window.orbit.storage.delete('tasks');
const keys = await window.orbit.storage.list(); // string[]
```

The bridge is injected before artifact code runs and only for HTML artifacts.
Requests travel over `postMessage`; the viewer resolves them from SQLite and
injects a reply callback. Values are scoped to the signed-in user and the
artifact id, so one artifact cannot read another's state.

Limits (characters, enforced in both the bridge and SQLite):

| Limit | Value |
| --- | --- |
| Key length | 200 |
| One value | 1,000,000 (~1 MB) |
| Combined values per artifact | 5,000,000 (~5 MB) |

Deleting an artifact (or its account) cascades to its key-value rows. The table
`artifact_kv` was added in database migration 18 → 19 (`DATABASE_VERSION = 19`).

## CDN setting

**Settings → Security → Artifacts → Allow libraries from cdnjs.cloudflare.com**
is off by default. When off, the system prompt tells the model to write
dependency-free vanilla JavaScript, inline SVG, and canvas. The artifact CSP is
unchanged: `connect-src 'none'` and no external script origins.

When the user turns it on, only `https://cdnjs.cloudflare.com` is added to
`script-src` for HTML previews. No other host is added to any directive, and
`connect-src` remains `'none'`. Markdown, SVG, and code artifacts keep scripts
disabled regardless of the setting.

## Runtime errors

HTML artifacts report uncaught errors and `console.error`/`console.warn` through
the same bridge. The viewer shows the message and offers **Fix with Orbit**,
which opens `/chat?prompt=...` with the artifact id and error pre-filled. The
chat does not auto-send; the user stays in control.
