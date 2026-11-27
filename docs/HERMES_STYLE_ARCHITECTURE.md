# Hermes-style system design for ORBIT

This document is the adaptation of the Hermes Agent architecture to ORBIT's
local-first, Android-first constraints. It is a design contract, not a promise
to reproduce Python code inside React Native. The goal is the same **shape** of
system: tool-first, provider-agnostic, skill-driven, bounded-memory,
interruption-safe, and observable — while every privileged action still ends at
`secureExecuteTool()` and the Android sandbox.

Non-negotiables inherited from `docs/OPERATIONS.md` and `docs/HARNESS.md`:

- Expo Router screens stay in `src/app/`; non-route code stays in `src/lib/`.
- No guest code, shell, `eval`, Node runtime, PTC, or downloaded code loader.
- Skills remain declarative data-only manifests.
- AI never grants permission, changes policy, or bypasses the sandbox.
- Canonical task states stay `QUEUED`, `PLANNING`, `RUNNING`,
  `WAITING_FOR_APPROVAL`, `VERIFYING`, `COMPLETED`, `FAILED`, `CANCELLED`,
  `BLOCKED`.
- No push, PR, merge, publish, or release without explicit approval.

## 1. Why this is additive

Hermes is a Python desktop/server agent. ORBIT is an offline-first mobile app
with an existing Cordis plugin spine, SQLite store, permission ledger, Rust
sandbox core, and WorkManager scheduler. Rewriting those boundaries would break
the product. The Hermes patterns are therefore introduced as a thin, typed
layer under `src/lib/hermes/` that **reads** existing registries and **feeds**
the existing hybrid controller. Nothing in this layer executes a capability.

## 2. Reference mapping

| Hermes subsystem | Hermes implementation | ORBIT equivalent / target |
| --- | --- | --- |
| Agent facade | `AIAgent` / `run_agent.py` | `runAgentTurn()` in `src/lib/hybrid-agent/controller.ts`, re-exported through `src/lib/ai/agent.ts` and `src/lib/agent-runtime/orchestrator.ts` |
| System-first loop | `conversation_loop.py`, tool dispatch before final reply | Deterministic intent router → bounded planner → `executeCapabilityCall()` → verification → optional AI |
| AI on demand | model call only when loop needs language | `ai-router.ts` gates on intent + configuration; small talk is now deferred to the deterministic path (Phase 1) |
| Prompt assembly | stable → context → volatile tiers, frozen snapshot | `src/lib/hermes/prompt-builder.ts` builds a bounded `HermesPromptBundle` once per turn with a fingerprint; volatile timestamp is fixed at turn start |
| Provider resolution | `runtime_provider.py` maps provider/model to api mode + credentials | `src/lib/hermes/provider-runtime.ts` maps `AiSettings` to a route (`chat-completions`, `gemini`, `ollama`, or `system`) plus a bounded fallback chain; secrets never enter events |
| Tool registry | import-time self-registration, toolsets, `check_fn` gating | Existing `agentToolRegistry`, `buildCapabilityCatalog()`, agent allowlists, grants; `src/lib/hermes/toolsets.ts` groups them into availability-filtered toolsets |
| Tools + approval | `tools/approval.py`, dangerous-command detection | `policyEngine`, `risk-controller.ts`, exact `ApprovalBinding`, `secureExecuteTool()`, Rust sandbox gate |
| Skills | `SKILL.md`, progressive disclosure, conditional activation, bundles, write approval | `src/lib/skills/manifest.ts` (strictly data-only), lifecycle versions; `src/lib/hermes/skill-catalog.ts` adds level‑0 index / level‑1 skill / level‑2 capability disclosure and toolset-based visibility |
| Memory | bounded `MEMORY.md` + `USER.md`, frozen snapshot, write approval | `src/lib/memory/store.ts` taxonomy + `prompt.ts` bounded section; Phase 1 freezes one snapshot per turn; Phase 2 adds char-budgeted `agent`/`user` stores and staged writes |
| Session search | SQLite FTS5, no LLM summarization | Phase 2: bounded keyword search over existing message rows; no embedding or cloud dependency |
| Cron | JSON jobs with attached skills and platform delivery | `src/lib/agent-runtime/scheduler.ts` + WorkManager (15-minute inexact minimum); jobs call the same controller with narrow grants |
| Subagents | isolated forks, explicit tools, own budgets | `src/lib/subagents/*`; grants are explicit and never inherited from the parent |
| Observability | tool callbacks, logs, trajectories | `ToolExecutionEvent` stream, `recordHybridEvent()` hash-chained audit ledger, redacted traces |

## 3. Target module map

```text
src/lib/hermes/                  # new, read-only architecture layer
  types.ts                       # prompt bundle, provider route, toolset, skill index
  prompt-builder.ts              # stable tiers → frozen bundle, bounded size
  provider-runtime.ts            # provider/model → adapter route + system fallback
  toolsets.ts                    # tool grouping filtered by allowlist/grants
  skill-catalog.ts               # progressive disclosure + conditional visibility
  index.ts                       # public surface
  hermes.test.ts                 # deterministic contract tests

src/lib/hybrid-agent/            # unchanged authority for state, risk, approval
  controller.ts                  # consumes hermes prompt/routes; owns transitions
  ai-router.ts                   # gates model use; system deferral lives here too
  intent-router.ts               # deterministic first pass, never calls an LLM
  approvals.ts / dispatcher.ts   # exact bindings and single dispatch boundary

src/lib/skills.ts / memory / ai / harness / sandbox   # existing sources of truth
```

`src/lib/hermes/` must never import `secureExecuteTool()` directly and must
never perform a network call. It only describes and bounds what the controller
may already do through the canonical boundary.

## 4. Turn lifecycle (Hermes shape, ORBIT boundaries)

```text
user message
  │
  ├─ 1. create/claim durable task (QUEUED → PLANNING)
  ├─ 2. deterministic intent router          [no model]
  ├─ 3. prohibited → hard refusal            [no model]
  ├─ 4. safe-auto → bounded plan → tools     [no model]
  ├─ 5. needs-AI:
  │    ├─ small talk / acknowledgement → deterministic reply  [no model, Phase 1]
  │    ├─ local fallback (no provider) → runLocalAgent        [no model]
  │    └─ provider configured:
  │         ├─ resolve provider route + fallback chain
  │         ├─ build frozen prompt bundle (policy, toolsets,
  │         │  level-0 skill index, memory, verified results)
  │         ├─ requestCompletion → tool calls → same approval/
  │         │  sandbox pipeline → verification (max 6 rounds)
  │         └─ canonical { ok:true } required to COMPLETE
  ├─ 6. VERIFYING → COMPLETED / FAILED / BLOCKED
  └─ 7. hash-chained audit event + UI tool-event stream
```

A timeout, cancellation, denied approval, or weak evidence never becomes
`COMPLETED`. An approval decision is recorded from the user's grant, not from a
later verification outcome.

## 5. Data contracts

### `HermesPromptBundle`
`{ system, snapshotId, fingerprint, tiers, createdAt }`. Built once per turn;
the timestamp and context are fixed at build time. `fingerprint` is a hash of
the stable sections so two turns with identical inputs produce identical
prefixes. The bundle carries tier names for audit, not executable instructions.

### `ProviderRoute`
`{ kind, provider, adapterId, baseUrl, model, configured, fallback }`.
`kind` is one of `chat-completions`, `gemini`, `ollama`, `system`. The chain is
always finite: one configured provider followed by the deterministic system
route. Unconfigured settings resolve directly to `system`; no network call.

### `ToolsetDescriptor`
`{ id, label, tools, available }`. `available` is the intersection of the
registry with the agent allowlist and active grants. Each descriptor is a
description of already-registered capabilities; it cannot register or run one.

### `SkillIndexEntry`
`{ id, name, description, capabilities }`. Level 0 is the short index embedded
in the prompt. Level 1 expands one skill; level 2 expands one capability's
data-only steps. Skills whose required tools are unavailable, or whose web
search capability is disabled, are hidden rather than executed.

### Bounded memory (target)
Two capped stores, `agent` (environment/lessons) and `user` (preferences),
with a frozen snapshot per session/turn and explicit staged writes. Memory text
is redacted and scanned for injection before it can enter a prompt.

## 6. Autonomy and security invariants

1. Deterministic routing always runs before any model call.
2. A model may propose a capability; it may not authorize one.
3. Every capability call re-enters classification, policy, exact approval
   binding, `secureExecuteTool()`, and the Rust sandbox gate.
4. Sensitive declarative skill invocations are blocked in the dispatcher and
   require a direct capability approval instead.
5. Changed parameters, resource/scope, policy version, or plan step invalidate
   an approval.
6. Subagents receive explicit narrow grants; they never inherit parent grants.
7. Recovery requeues only side-effect-free work; pending approvals are never
   auto-approved.
8. No downloads of code, no plugin hook execution, no guest runtime.

## 7. Rollout plan

- **Phase 0 — done:** hybrid controller, canonical states, approval ledger,
  v17 migration, sandbox/policy hardening, exhaustive local verification.
- **Phase 1 — this change:** Hermes-shaped read-only layer (prompt tiers,
  provider routes, toolsets, skill disclosure) plus deterministic deferral of
  small talk so a configured provider is not called for greetings/acknowledges.
- **Phase 2 — next:** char-budgeted `agent`/`user` memory snapshot with staged
  writes and bounded SQLite session search; skill bundles and conditional
  fallback skills; audit-visible learning proposals (deterministic, opt-in).
- **Phase 3 — later:** route-level provider fallback with explicit, redacted
  diagnostics; cron job skill attachment and delivery telemetry; richer
  harness snapshot of the Hermes layer. No iOS work in this plan.

## 8. Verification

Every phase must pass the full loop from `docs/OPERATIONS.md`:

```bash
cargo test --locked --manifest-path sandbox-core/Cargo.toml
npx tsc --noEmit
npx expo lint
npm test
npm run test:rn
npx expo export --platform android --no-bytecode --output-dir /tmp/opencode/orbit-export
```

The Android export uses `--no-bytecode` because Hermes bytecode compilation is
unreliable in this container. A green local loop is necessary but not sufficient
for merge: the branch still needs the required GitHub checks and a reviewed PR.
