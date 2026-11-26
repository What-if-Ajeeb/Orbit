# ORBIT Sandbox — core design

Status: **design-only**. Android only. No iOS. No standalone Sandbox UI.
ORBIT Sandbox is invisible behind ORBIT Agent and the Plugin Runtime.

This document describes the core security model only. It contains no executable
code, no program runner, no test runner, and no guest-code runtime.

## Core idea

ORBIT Sandbox ek **security policy aur mediation boundary** hai, runtime nahi.
Agent jab bhi kisi reviewed plugin ke through kisi protected resource tak pahunchna
chahe, to woh seedha file ya network access nahi karta. Pehle Rust policy
decision aata hai, uske baad Kotlin Android layer actual platform boundary
enforce karti hai, aur antim result audit me likha jata hai.

## Example: Agent kisi plugin se file read karna chahta hai

┃ Agent request bhejega.
┃
┃ Plugin Runtime us request ko apne normal secure tool pipeline se pass karega.
┃
┃ Rust policy core check karega ki:
┃   - plugin manifest valid hai ya nahi;
┃   - plugin ko required permission declared aur granted hai ya nahi;
┃   - fresh, one-time approval evidence hai ya nahi;
┃   - operation allowlist me hai ya nahi;
┃   - relative path safe hai ya nahi (traversal, absolute path, encoded
┃     separator, symlink risk);
┃   - envelope, path aur file limits ke andar hai ya nahi.
┃
┃ Rust khud file nahi kholta. Woh sirf `allow` ya `deny` ka policy decision
┃ deta hai.
┃
┃ Agar permission / approval / path valid ho to operation allow hoga.
┃ Warna deny — koi file read nahi hoga.
┃
┃ Allow ke baad Kotlin Android layer actual platform boundary enforce karegi:
┃   - target app-private `filesDir` ke andar hai;
┃   - koi symlink escape nahi hai;
┃   - canonical containment valid hai;
┃   - target regular file hai;
┃   - 256 KiB se chhota hai;
┃   - UTF-8 text hai.
┃
┃ Final result hash-only audit record ke saath `plugin_permission_audit` me
┃ `sandbox_operation` event ke taur par save hoga.
┃
┃ Is system mein Sandbox khud koi code execute nahi karega. Na Node, na Python,
┃ na JavaScript, na WASM, na shell, na guest-code runtime, na code runner,
┃ na test runner.

## Kya kahan chalta hai

| Component | Process | Kya karta hai | Kya nahi karta |
|---|---|---|---|
| ORBIT Agent | Main app | Tool call bhejta hai | File direct nahi padhta |
| Plugin Runtime | Main app | Permission, approval, tool ownership check karta hai | Guest code nahi chalata |
| MobileSandboxManager | Main app | Approval evidence, session, audit orchestrate karta hai | File/network access nahi karta |
| Kotlin Expo module | Main app | Rust decision ke baad bounded app-private read karta hai | Policy decide nahi karta |
| Isolated Android service | Isolated process | Sirf Messenger/JNI se policy envelope forward karta hai | File ya network access nahi karta |
| Rust policy core | Isolated process | Manifest, permission, approval, path, URL validate karta hai | File, network, process, code execute nahi karta |
| Audit store | Main app / SQLite | Hash-only decision records save karta hai | Raw content save nahi karta |

## Active aur dormant surface

- Abhi active surface read-only security tools hain: `sandbox_policy`,
  `sandbox_validate_manifest`, `sandbox_check_permission`,
  `sandbox_validate_path`, `sandbox_validate_network`,
  `sandbox_validate_request`, aur `sandbox_authorize_operation`.
- Raw file-read mediation implemented hai, lekin kisi production agent tool se
  expose nahi hai. Ye sirf reviewed host plugin ke liye dormant capability hai.
- Isliye agent ke paas `run_code`, `run_tests`, `bench_solution`,
  `sandbox_compute`, `sandbox_echo` ya koi bhi execution-shaped tool nahi hai.

## Fail-closed rules

Koi bhi boundary unavailable, invalid ya expired ho to operation deny hota hai:

- native library missing → deny;
- malformed envelope → deny;
- unknown method ya unknown field → deny;
- binding fail, disconnect ya timeout → deny;
- approval denied, timeout ya replay → deny;
- Rust deny → Kotlin file read nahi karti;
- Kotlin boundary deny → content return nahi hota.

Koi bhi failure direct file read, unmediated network ya local execution me
convert nahi hoti.

## Non-goals

- iOS ya web sandbox.
- Guest code, program, script, shell, WASM ya koi bhi runtime.
- Code runner ya test runner.
- Standalone Sandbox screen, tab, drawer item ya settings page.
- Isolated process se file ya network access.
- Complete isolation kernel, Binder ya compromised device se.

Ye sirf Android app ke andar bounded policy aur platform-boundary mediation hai.
Implementation aur koi bhi code change tabhi shuru hoga jab architecture clearly
approve ki jayegi.
