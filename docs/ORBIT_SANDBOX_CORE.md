# ORBIT Sandbox — System Design

Status: **design-only**. Android only. No iOS. No standalone Sandbox UI.
ORBIT Sandbox invisible hai — ye ORBIT Agent aur Plugin Runtime ke peeche kaam
karta hai.

Sandbox khud **koi code execute nahi karta**: na Node, na Python, na JavaScript,
na WASM, na shell, na guest-code runtime, na code runner, na test runner.

## Simple 4-layer architecture

```
ORBIT Sandbox — System Design

1. ORBIT Agent / Plugin Runtime
   Plugin action request karta hai

2. Rust Security Policy Core
   Manifest · Permissions · Policy · Validation · Audit

3. Kotlin Android Enforcement Layer
   Isolated Process · IPC · OS Permissions · Lifecycle

4. Approved Plugin Operation
   Allowed / Denied · Approval required · Audit result
```

| Layer | Kya karta hai | Kya nahi karta |
|---|---|---|
| 1. ORBIT Agent / Plugin Runtime | Reviewed plugin ke through protected resource ke liye action request bhejta hai | File ya network direct access nahi karta |
| 2. Rust Security Policy Core | Manifest, permission, approval, path/URL aur limits validate karke `allow` ya `deny` deta hai | File, network, process ya code execute nahi karta |
| 3. Kotlin Android Enforcement Layer | Rust decision ke baad actual platform boundary enforce karti hai | Policy decide nahi karti |
| 4. Approved Plugin Operation | Allowed / denied result aur audit record produce karta hai | Raw content ya code execution nahi karta |

## Example: Agent kisi plugin se file read karna chahta hai

- Agent request bhejega.
- Plugin Runtime us request ko apne normal secure tool pipeline se pass karega.
- Rust policy check karega ki plugin ko permission hai ya nahi:
  - plugin manifest valid hai ya nahi;
  - required permission declared aur granted hai ya nahi;
  - fresh, one-time approval evidence hai ya nahi;
  - approval evidence usi exact path/URL ke liye hai ya nahi (doosre resource par
    replay nahi hota; normalization ke baad compare hota hai);
  - relative path safe hai ya nahi (traversal, absolute path, encoded separator,
    symlink risk);
  - envelope, path aur file limits ke andar hai ya nahi.
- Rust khud file nahi kholta — woh sirf `allow` ya `deny` ka policy decision deta
  hai.
- Allow ke baad Kotlin Android layer actual platform boundary enforce karegi:
  - target app-private `filesDir` ke andar hai;
  - koi symlink escape nahi hai;
  - canonical containment valid hai;
  - target regular file hai;
  - 256 KiB se chhota hai;
  - UTF-8 text hai.
- Permission valid ho to operation allow hoga; warna deny — koi file read nahi
  hoga.
- Final result hash-only audit record ke saath `plugin_permission_audit` me
  `sandbox_operation` event ke taur par save hoga.
- Is system mein Sandbox khud koi code execute nahi karega.

## Kya kahan chalta hai

| Component | Process | Role |
|---|---|---|
| ORBIT Agent | Main app | Tool call bhejta hai |
| Plugin Runtime | Main app | Permission, approval, tool ownership check karta hai |
| MobileSandboxManager | Main app | Approval evidence, session, audit orchestrate karta hai |
| Kotlin Expo module | Main app | Rust decision ke baad bounded app-private read karta hai |
| Isolated Android service | Isolated process | Sirf Messenger/JNI se policy envelope forward karta hai |
| Rust policy core | Isolated process | Manifest, permission, approval, path, URL validate karta hai |
| Audit store | Main app / SQLite | Hash-only decision records save karta hai |

## Active aur dormant surface

- Active surface read-only security tools hain: `sandbox_policy`,
  `sandbox_validate_manifest`, `sandbox_check_permission`,
  `sandbox_validate_path`, `sandbox_validate_network`,
  `sandbox_validate_request`, aur `sandbox_authorize_operation`.
- Raw file-read mediation implemented hai, lekin kisi production agent tool se
  expose nahi hai. Ye sirf reviewed host plugin ke liye dormant capability hai.
- Agent ke paas `run_code`, `run_tests`, `bench_solution`, `sandbox_compute`,
  `sandbox_echo` ya koi bhi execution-shaped tool nahi hai.

## Fail-closed rules

Koi bhi boundary unavailable, invalid ya expired ho to operation deny hoti hai:

- native library missing → deny;
- malformed envelope → deny;
- unknown method ya unknown field → deny;
- binding fail, disconnect ya timeout → deny;
- approval denied, timeout, doosre resource par replay ya resource ke bina → deny;
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
