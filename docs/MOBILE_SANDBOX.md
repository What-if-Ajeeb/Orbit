# ORBIT Mobile Sandbox

ORBIT Sandbox is Android-only security and mediation infrastructure behind ORBIT
Agent and the Plugin Runtime. It has no standalone screen, tab, drawer item or
settings page, and it never executes guest code: no Node, Python, JavaScript,
WASM, shell, code runner or test runner.

The canonical design is [`ORBIT_SANDBOX_CORE.md`](ORBIT_SANDBOX_CORE.md).

## Four layers

```text
1. ORBIT Agent / Plugin Runtime
   Plugin action request karta hai

2. Rust Security Policy Core
   Manifest · Permissions · Policy · Validation · Audit

3. Kotlin Android Enforcement Layer
   Isolated Process · IPC · OS Permissions · Lifecycle

4. Approved Plugin Operation
   Allowed / Denied · Approval required · Audit result
```

| Layer | Responsibility | Does not do |
|---|---|---|
| Agent / Plugin Runtime | Sends a request through a reviewed plugin tool | Direct file or network access |
| Rust Security Policy Core | Validates manifest, permission, resource-bound approval, path/URL and limits; returns `allow` or `deny` | Read files, open sockets, start processes or execute code |
| Kotlin Android layer | Enforces the platform boundary after Rust allows | Decide policy |
| Approved operation | Returns allowed/denied result and a hash-only audit record | Execute guest code |

## Approved file read

`sandbox_read_file` is the only production operation that touches a resource. It
is exposed by the reviewed `orbit.builtin.sandbox` plugin and requires:

1. A `files.read` grant and an active `ai.invoke` grant.
2. A fresh approval bound to the exact normalized resource.
3. A Rust `allow` decision for `file.read`.
4. A Kotlin bounded read from the app-private `filesDir` only:
   - canonical containment;
   - no symlinks;
   - regular file only;
   - at most 256 KiB;
   - valid UTF-8 text.
5. A `sandbox_operation` audit record in `plugin_permission_audit`.

Invalid paths are rejected before the approval prompt. An approval for one path
cannot be replayed for another path or URL. Every unavailable, malformed,
expired, disconnected or timed-out boundary fails closed.

## Active tools

`orbit.builtin.sandbox` exposes read-only policy inspection plus the reviewed
read operation:

- `sandbox_policy`
- `sandbox_validate_manifest`
- `sandbox_check_permission`
- `sandbox_validate_path`
- `sandbox_validate_network`
- `sandbox_validate_request`
- `sandbox_authorize_operation`
- `sandbox_read_file`

`files.write`, arbitrary network transport and guest-code execution are not
exposed. The isolated service has no network API and no Android file access; only
the app-process Kotlin boundary performs the bounded read after Rust allows it.
