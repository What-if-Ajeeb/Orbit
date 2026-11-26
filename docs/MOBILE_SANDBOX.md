# ORBIT Android mobile sandbox

ORBIT's mobile sandbox is an **Android-only subsystem inside the main ORBIT app**.
There is no second APK, no second app to install, and no separate server. The React
Native app remains the management surface; Android-native privilege separation and
Rust policy enforcement run behind an Expo Module.

> This is a process boundary plus a deterministic policy interpreter. It is not a
> claim of complete isolation from the Android kernel, Binder, or the host app.

## Architecture

```text
React Native (TypeScript)                 Android app process
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ Sandbox screen               │          │ OrbitMobileSandboxModule     │
│ MobileSandboxManager         │──Expo───▶│ (Kotlin, Expo Modules API)   │
│ ORBIT approval host          │  Module  │ bind / correlate / timeout   │
└──────────────────────────────┘          └───────────────┬──────────────┘
                                                          │ Messenger/Binder
                                                          ▼
                                          ┌──────────────────────────────┐
                                          │ OrbitSandboxService          │
                                          │ android:isolatedProcess=true │
                                          │ ┌──────────────────────────┐ │
                                          │ │ Rust sandbox core (JNI)  │ │
                                          │ │ validate + policy + VM   │ │
                                          │ └──────────────────────────┘ │
                                          └──────────────────────────────┘
```

- **TypeScript** owns lifecycle, manifests, user approval, session history, and UI.
- **Kotlin** only binds the service, serializes messages, correlates replies, and
  enforces a 15-second call timeout. It does not evaluate plugin policy.
- **Rust** validates manifests, enforces the fixed policy, and interprets a small
  deterministic instruction set. It has no filesystem, network, permission, or
  JavaScript APIs.
- The service is declared `exported="false"` and `isolatedProcess="true"` in the
  autolinked module manifest. It has no Android permissions of its own.

## What can run

A sandbox "program" is JSON data, not code:

```json
{
  "pluginId": "orbit.example.sandbox",
  "version": "1.0.0",
  "program": {
    "version": 1,
    "instructions": [
      { "op": "push", "value": "hello " },
      { "op": "load", "key": "input", "field": "name" },
      { "op": "concat" },
      { "op": "emit", "key": "greeting" },
      { "op": "return" }
    ]
  }
}
```

Supported operations: `push`, `load`, `add`, `sub`, `mul`, `concat`, `emit`,
`return`. `load` may read only the host-supplied `input` object. Unknown fields and
unknown operations are rejected before execution.

Fixed policy (version 1): at most 256 instructions, 64 stack items, 8 KB per
value, 16 KB total output, and a 64 KB request envelope. Callers cannot supply or
override the policy. Arithmetic overflow, oversized values, and stack underflow are
controlled errors.

There is no JavaScript loader. The existing plugin platform still rejects
downloaded executable code and legacy hook scripts; `runHookCode()` remains
disabled.

## Plugin tools

A reviewed built-in plugin can declare a tool with a data-only `program` instead
of a host `execute` function. `PluginRegistry` keeps ownership, namespacing,
schema validation, timeouts and permission checks; `buildPluginAgentTool` routes
only that tool body through the existing `MobileSandboxManager`. The built-in
diagnostics plugin uses this path for `plugin__orbit_builtin_diagnostics__sandbox_echo`,
and `orbit.builtin.sandbox` uses the same bridge with fixed, reviewed programs
for `sandbox_compute`; raw instructions are never accepted from callers.

This is not a second runtime and not a new entry-point kind. The tool still uses
the same registry, SDK, approval queue and agent tool registry. On non-Android
platforms the native transport is unavailable, so the tool fails closed with a
clear error. MCP servers remain plugin integrations with a host-side network
bridge; the isolated core has no network API, so their transport is not moved
into the sandbox.

## Permission and approval

Before every execution, `MobileSandboxManager` asks the existing
`PluginApprovalHost` for the `sandbox.execute` permission. The request uses
`trustLevel: 'untrusted'` and a high-risk label. Denial, timeout, or a missing
approval host means the Rust core is never called. There is no persistent blanket
grant for this path.

## User-facing surface

The mobile sandbox is backend-only. It has no screen, sidebar item, settings
entry, or ORBIT branding. Users see only the normal permission/approval flow:
when a reviewed plugin requests sandbox execution, `PluginApprovalHost` shows the
action and risk, and the Rust core runs only after explicit approval. On web,
iOS, and Expo Go the native module is never loaded, so the code path is never
available.

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
(`.github/workflows/android.yml`) performs the same steps, verifies the library is
inside the APK/AAB, and fails the build if it is missing. Over-the-air JS updates
cannot add or change the native core; a new native build is required.

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

Android compilation and device behavior are verified in CI because this repository
does not commit generated `android/` sources.

## Security properties and limits

Provided:

- untrusted plugin data is interpreted in a separate Android process with no
  Android permissions;
- all policy decisions happen in Rust, not in React Native or Kotlin;
- only a fixed, bounded, pure instruction set is available;
- files, network, device permissions, arbitrary native code, and JavaScript are
  not reachable from a sandbox program;
- malformed envelopes, unavailable native libraries, bind failures, timeouts, and
  panics fail closed with structured errors.

Not provided:

- complete isolation from the Android kernel, Binder driver, or a compromised
  device;
- a general-purpose plugin runtime or arbitrary third-party code execution;
- hardware-backed attestation, formal verification, or a security audit;
- protection against a malicious app that already holds the Android app-signing
  key and can replace the whole APK.

Do not describe this subsystem as a "complete sandbox" for arbitrary code. It is a
bounded, data-only execution boundary owned by ORBIT.
