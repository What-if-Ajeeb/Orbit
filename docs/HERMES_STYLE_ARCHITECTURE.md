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
| Provider resolution | `runtime_provider.py` maps provider/model to api mode + credentials | `src/lib/hermes/provider-runtime.ts` maps `AiSettings` to a route (`chat-completions`, `gemini`, `ollama`, or `system`) plus a bounded fallback chain; `provider-fallback.ts` tries that one provider at most once and emits allowlisted diagnostics; secrets never enter events |
| Tool registry | import-time self-registration, toolsets, `check_fn` gating | Existing `agentToolRegistry`, `buildCapabilityCatalog()`, agent allowlists, grants; `src/lib/hermes/toolsets.ts` groups them into availability-filtered toolsets |
| Tools + approval | `tools/approval.py`, dangerous-command detection | `policyEngine`, `risk-controller.ts`, exact `ApprovalBinding`, `secureExecuteTool()`, Rust sandbox gate |
| Skills | `SKILL.md`, progressive disclosure, conditional activation, bundles, write approval | `src/lib/skills/manifest.ts` (strictly data-only), lifecycle versions; `src/lib/hermes/skill-catalog.ts` adds level‑0 index / level‑1 skill / level‑2 capability disclosure and toolset-based visibility |
| Memory | bounded `MEMORY.md` + `USER.md`, frozen snapshot, write approval | `src/lib/memory/store.ts` taxonomy + `prompt.ts` bounded section; Phase 1 freezes one snapshot per turn; Phase 2 adds char-budgeted `agent`/`user` stores and staged writes |
| Session search | SQLite FTS5, no LLM summarization | Phase 2: bounded keyword search over existing message rows; no embedding or cloud dependency |
| Cron | JSON jobs with attached skills and platform delivery | `src/lib/agent-runtime/scheduler.ts` + WorkManager (15-minute inexact minimum); jobs call the same controller with narrow grants; validated `skillBundleIds` are disclosure-only and delivery stages are hash-audited |
| Subagents | isolated forks, explicit tools, own budgets | `src/lib/subagents/*`; grants are explicit and never inherited from the parent |
| Observability | tool callbacks, logs, trajectories | `ToolExecutionEvent` stream, `recordHybridEvent()` hash-chained audit ledger, redacted traces |

## 3. Target module map

```text
src/lib/hermes/                  # new, read-only architecture layer
  types.ts                       # prompt bundle, provider route, toolset, skill index
  prompt-builder.ts              # stable tiers → frozen bundle, bounded size
  provider-runtime.ts            # provider/model → adapter route + system fallback
  provider-fallback.ts           # one-provider request + deterministic system fallback
  delivery-telemetry.ts          # hash-only queued/started/delivered/failed stages
  scheduled-bundles.ts           # bounded, validated data-only bundle ids
  toolsets.ts                    # tool grouping filtered by allowlist/grants
  skill-catalog.ts               # progressive disclosure + conditional visibility
  skill-bundles.ts               # data-only bundle parsing/resolution
  memory-budget.ts               # bounded, frozen agent/user snapshot
  memory-write-store.ts          # exact-preview staged writes, approval-gated apply
  session-search.ts              # bounded SQLite keyword recall
  index.ts                       # public surface
  hermes.test.ts                 # deterministic contract tests

src/lib/hybrid-agent/            # unchanged authority for state, risk, approval
  controller.ts                  # consumes hermes prompt/routes; owns transitions
  ai-router.ts                   # gates model use; system deferral lives here too
  intent-router.ts               # deterministic first pass, never calls an LLM
  approvals.ts / dispatcher.ts   # exact bindings and single dispatch boundary

src/lib/harness/hermes.ts        # pure Hermes contract disclosure in snapshots
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
  │         ├─ route wrapper: one provider call at most, then system
  │         ├─ provider/tool calls → same approval/
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

### `ProviderDiagnostic`
`{ route, kind, provider, adapterId, configured, outcome, errorKind?, status?, elapsedMs, snapshotId? }`.
Only allowlisted primitives are emitted. Raw error messages, stack traces,
provider URLs (including userinfo/query strings), keys, model text, prompts and
tool payloads are never recorded. The wrapper buffers streaming deltas and
releases them only on success; a failed request cannot leave partial text.
Cancellation and budget control-flow errors are rethrown, never downgraded to
system work.

### Delivery and scheduled bundle data
`skillBundleIds` on a schedule input is a bounded (max four), validated list of
built-in bundle ids. Ids are resolved at execution time against currently
visible, grants-filtered skills; bundles remain disclosure-only and are never
registered or dispatched. Delivery stages (`queued`, `started`, `delivered`,
`failed`) are written to the hash-chained audit ledger with hashes, ids, counts
and fixed error categories only — no instruction or reply text.

### `HermesContractSnapshot`
Exposed on the harness snapshot from static registries and built-in declarative
data. It reports the provider route, toolset ids/counts, visible skills and
bundles, prompt tiers/size, memory and session-search bounds, and a descriptor
fingerprint. It performs no DB reads, network calls, model calls or tool
execution; the harness screen renders it as read-only disclosure.

### `ToolsetDescriptor`
`{ id, label, tools, available }`. `available` is the intersection of the
registry with the agent allowlist and active grants. Each descriptor is a
description of already-registered capabilities; it cannot register or run one.

### `SkillIndexEntry`
`{ id, name, description, capabilities, kind?, skillIds? }`. Level 0 is the short
index embedded in the prompt. Level 1 expands one skill or disclosure-only
bundle; level 2 expands one capability's data-only steps. Skills whose required
tools are unavailable, whose web search capability is disabled, or whose
`fallbackForTools` / `fallbackForToolsets` are already available are hidden
rather than executed. Bundles are never registered or dispatched as tools.

### Bounded memory
Two capped stores, `agent` (environment/lessons) and `user` (preferences),
with a frozen snapshot per turn and explicit staged writes. Memory text is
redacted, secret-keyed entries are skipped, and injection-shaped values are
rejected before they can enter a prompt. `agent_memory_writes` (v18) stores exact
previews; only a user-approved, unmodified, unexpired stage can call
`MemoryStore.remember()` / `forget()`. All transitions are written to the
hash-chained audit ledger.

### Session search
`ChatStore.searchMessages()` uses bound `LIKE ... ESCAPE` parameters, at most
four escaped terms, a 20-row cap and conversation/user scoping. Hermes wraps the
rows into redacted, scored, character-bounded `HermesSessionHit` entries; no
embeddings, model summaries or cloud calls are used.

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
9. Provider fallback never calls a second network provider; it returns bounded
   deterministic text with no tool calls and no claim of completion.
10. Bundles, scheduled bundle ids and harness disclosures are data only. They
    never register tools, change grants, or bypass the sandbox.

## 7. Rollout plan

- **Phase 0 — done:** hybrid controller, canonical states, approval ledger,
  v17 migration, sandbox/policy hardening, exhaustive local verification.
- **Phase 1 — done:** Hermes-shaped read-only layer (prompt tiers, provider
  routes, toolsets, skill disclosure) plus deterministic deferral of small talk
  so a configured provider is not called for greetings/acknowledges.
- **Phase 2 — done:** char-budgeted `agent`/`user` snapshot frozen per turn,
  exact-approved staged memory writes (v18), bounded SQLite session search,
  disclosure-only skill bundles and conditional fallback skills. Audit events
  cover staging, approval, denial and application. No learning loop writes
  memory without the same exact approval.
- **Phase 3 — this change:** one-provider route wrapper with allowlisted,
  redacted diagnostics; bounded data-only bundle ids on cron schedules with
  hash-only delivery telemetry; pure Hermes contract disclosure in the harness
  snapshot. No iOS work in this plan.

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
