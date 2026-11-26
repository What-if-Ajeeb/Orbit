# ORBIT Android mobile sandbox

ORBIT's mobile sandbox is an **Android-only security boundary inside the main
ORBIT app**. It does not execute guest code and it is not a general plugin
runtime. It validates manifests and requests, enforces permissions and approvals,
and mediates a small set of privileged operations. There is no second APK, no
second app to install, and no separate server.

> This is a policy boundary plus an Android isolated-process boundary. It is not
> a claim of complete isolation from the Android kernel, Binder, or the host app.

## Architecture

```text
React Native (TypeScript)                  Android app process
┌───────────────────────────────┐          ┌───────────────────────────────────┐
│ Plugin Registry               │          │ OrbitMobileSandboxModule          │
│ MobileSandboxManager          │──Expo───▶│ (Kotlin, Expo Modules API)        │
│ ORBIT approval host           │  Module  │ bind / correlate / timeout        │
│ Plugin permission audit       │          │ bounded file read + path checks   │
└───────────────────────────────┘          └────────────────┬──────────────────┘
                                                            │ Messenger/Binder
                                                            ▼
                                           ┌───────────────────────────────────┐
                                           │ OrbitSandboxService               │
                                           │ android:isolatedProcess=true     │
                                           │ ┌───────────────────────────────┐ │
                                           │ │ Rust sandbox core (JNI)       │ │
                                           │ │ validate / policy / audit     │ │
                                           │ │ no files, network or executor  │ │
                                           │ └───────────────────────────────┘ │
                                           └───────────────────────────────────┘
```

- **TypeScript** owns lifecycle, request validation, fresh approval evidence,
  session history, and audit persistence through the existing plugin audit
  table. It never reads arbitrary files from the sandbox bridge.
- **Kotlin in the app process** only binds the service, serializes messages,
  correlates replies, enforces a 15-second call timeout, and performs the
  bounded file read. It makes no policy decisions.
- **Kotlin in the isolated service** is a policy-only messenger: it forwards
  envelopes to Rust and returns structured responses. It has no file access and
  no network access.
- **Rust** makes every security decision. It has no filesystem, network,
  permission, approval, JavaScript, or execution APIs.
- The service is declared `exported="false"` and `isolatedProcess="true"` in the
  autolinked module manifest. It has no Android permissions of its own.

## What the sandbox can do

Policy version 2 exposes these security capabilities:

- plugin manifest validation, including rejection of execution-shaped fields;
- permission checks against declared and granted permissions;
- fresh approval-evidence verification with a bounded TTL;
- relative path validation for traversal, absolute paths, encoded separators,
  and length;
- HTTPS/network-URL validation that rejects credentials, private, and loopback
  hosts without making a request;
- request-envelope validation with a method allowlist and field-size limits;
- structured allow/deny decisions with hash-only resource identifiers and audit
  records.

The only operation names accepted by `authorizeOperation` are `file.read`,
`file.stat`, and `network.request`. These names describe policy decisions, not a
general execution API. There is no `program`, `instructions`, `push`, `emit`,
`evaluate`, `runCode`, JavaScript loader, or deterministic guest interpreter.
Any request containing execution-shaped fields is rejected.

Fixed policy limits (callers cannot override them):

| Limit | Value |
| --- | ---: |
| Request envelope | 64 KiB |
| Bounded file read | 256 KiB |
| Relative path | 1 KiB |
| Network URL | 2 KiB |
| Request fields | 32 |
| Approval evidence TTL | 300 seconds |

Malformed envelopes, unknown methods, oversized values, unavailable native
libraries, bind failures, timeouts, and panics fail closed with structured
errors.

## Canonical file-read flow

A reviewed plugin may request a mediated read. The flow is:

1. The plugin supplies a manifest, a relative path, its granted permissions,
   and short-lived approval evidence obtained through the existing
   `PluginApprovalHost`.
2. Kotlin in the app process forwards the request to the isolated service.
   Rust verifies the manifest, permission, approval freshness, and normalized
   path, then returns an `allow` or structured `deny`.
3. Only after Rust returns `allow`, Kotlin in the app process re-checks the
   path inside the app-private `filesDir`, rejects symlinks, canonicalizes the
   target, requires a regular file, enforces the byte limit, and performs a
   bounded UTF-8 read. The isolated service itself never reads the file.
4. The result and a hash-only audit record return through TypeScript, where the
   decision is persisted with `plugin_permission_audit` as a
   `sandbox_operation` event.

There is no generic agent-facing raw file-read tool. The existing Files plugin
continues to work through `ArtifactStore`; raw-file mediation is reserved for
reviewed host plugins.

## Plugin surface

Security capabilities are exposed only through the existing Plugin Registry and
the reviewed `orbit.builtin.sandbox` plugin. `MobileSandboxManager` is the single
transport owner; the registry remains responsible for ownership, namespacing,
schema validation, permission checks, timeouts, and tool registration. The
sandbox plugin registers read-only tools such as `sandbox_policy`,
`sandbox_validate_manifest`, `sandbox_check_permission`, `sandbox_validate_path`,
`sandbox_validate_network`, `sandbox_validate_request`, and
`sandbox_authorize_operation`.

Builder-authored actions and `mcpTools` entries remain inert metadata. They do
not carry host code, guest programs, presets, or handlers. The builder no longer
has a Testing playground, and no tool named `run_code`, `run_tests`,
`bench_solution`, `sandbox_compute`, or `sandbox_echo` is registered. Legacy
manifests containing execution-shaped fields or the retired `sandbox.execute`
permission are normalized and disabled until reviewed and explicitly enabled.

MCP servers remain plugin integrations with host-side transports. The isolated
core has no network API, so their transport is not moved into the sandbox. The
separate `computer_execute` tool targets a paired ORBIT Desktop Companion; it is
not part of the mobile sandbox.

## Permission and approval

Read-only validation and inspection require `sandbox.inspect`. Sensitive
operations require `files.read`, `files.write`, or `network.access` as appropriate.
A saved permission grant is never sufficient for a sensitive operation:
`MobileSandboxManager.requestOperationApproval()` asks the existing approval
host for fresh evidence, and Rust verifies the permission, TTL, and request ID
before allowing the operation. Denial, timeout, or a missing approval host
means the privileged bridge call is never performed.

## User-facing surface

The mobile sandbox is backend-only. It has no screen, sidebar item, settings
entry, or separate ORBIT branding. Users see only the normal permission and
approval flow. When a reviewed plugin requests mediated sandbox access,
`PluginApprovalHost` explains that Rust checks every operation and the Android
boundary enforces it. On web, iOS, and Expo Go the native module is unavailable,
so the code path fails closed.

## Building

The Rust library is compiled for all four Android ABIs and copied into the local
Expo module's `jniLibs` before `expo prebuild`:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi \
  i686-linux-android x86_64-linux-android
cargo install cargo-ndk --version 4.1.2 --locked

REPO_DIR="$(pwd)"
JNI_DIR="${REPO_DIR}/modules/orbit-mobile-sandbox/android/src/main/jniLibs"
mkdir -p "$JNI_DIR"
cd sandbox-core
cargo ndk \
  -t armeabi-v7a -t arm64-v8a -t x86 -t x86_64 \
  -o "$JNI_DIR" \
  build --release --locked
cd "$REPO_DIR"

npx expo run:android
```

`cargo ndk` reads crate metadata from the current directory, so it must run from
`sandbox-core`. Passing `--manifest-path` after `build` is a Cargo argument and
does not help `cargo-ndk` find the crate.

Generated `.so` files and Rust build output are gitignored. CI
(`.github/workflows/android.yml`) performs the same steps, verifies the library
is inside the APK/AAB, and fails the build if it is missing. Over-the-air JS
updates cannot add or change the native core; a new native build is required.

## Verification

```bash
cargo test --locked --manifest-path sandbox-core/Cargo.toml
cargo check --locked --manifest-path sandbox-core/Cargo.toml --target aarch64-linux-android --lib
npx tsc --noEmit
npx expo lint
npm test
npm run test:rn
npx expo export --platform android --no-bytecode --output-dir /tmp/opencode/orbit-export
```

Android compilation and device behavior are verified in CI because this
repository does not commit generated `android/` sources.

## Security properties and limits

Provided:

- every policy decision happens in the data-only Rust core, not in React Native
  or Kotlin;
- the isolated service has no Android permissions, file access, or network
  access;
- sensitive operations require fresh approval evidence and a declared, granted
  permission;
- the only file read is a bounded, UTF-8, app-private read performed in the app
  process after an explicit Rust `allow`;
- paths are checked for traversal, symlinks, canonical containment, and file
  type before reading;
- resources are represented in audit records by hash and byte count, not raw
  contents;
- malformed envelopes, unavailable native libraries, bind failures, timeouts,
  and panics fail closed with structured errors.

Not provided:

- execution of arbitrary code, deterministic guest instructions, or a general
  plugin runtime;
- complete isolation from the Android kernel, Binder driver, or a compromised
  device;
- network requests from inside the isolated core;
- general agent access to raw files or external storage;
- hardware-backed attestation, formal verification, or a security audit;
- protection against a malicious app that already holds the Android app-signing
  key and can replace the whole APK.

Do not describe this subsystem as a "complete sandbox" for arbitrary code. It is
a bounded, security-only policy and mediation boundary owned by ORBIT.
