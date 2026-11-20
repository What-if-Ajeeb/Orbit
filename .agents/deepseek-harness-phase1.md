# Orbit Plugin Integration — Implementation Plan (Phase 1)

All work: **Phase 0 — integrate Cordis, mount Orbit spine. Phase 1 — port Orbit seams onto plugins (tools, providers, storage, MCP).**

## Phase 0 — Integrate Cordis + mount Orbit spine plugins

### Changes
- **`package.json`**: add `cordis` (published upstream, MIT) as dep. Vendor docs copied to `vendor/README.md` (DeepSeek vendor table from upstream repo).
- **New `src/lib/harness/spine/`**:
  - `cordis.ts` — re-exports `Context`, `Service`, plugin types; wraps auto-dispose lifecycle for Orbit's root.
  - `context.ts` — Orbit creates `new Context()` (root) and mounts core spine plugins; exposes `AppContext` singleton + `getOrbitContext()` used by providers.
  - `boot.ts` — `HarnessProvider` (React component) calling once: `mountOrbitSpine()` and dep rec initialization; used in `src/app/_layout.tsx`.
- **`src/app/_layout.tsx`**: wrap `RootLayout` with `HarnessProvider`.

### Files to create (Phase 0)
- `src/lib/harness/spine/context.ts`
- `src/lib/harness/spine/boot.ts`
- `src/lib/harness/cordis.ts` (re-export for consumers)

### `orbit-session` (`src/lib/harness/plugins/orbit-session.ts`)
- `class OrbitSession extends Service` with key `orbit.sessions`
- Delegates to existing `chat-store` module (getChatStore(db) — Conversation/Message CRUD already exists).
- Notify `session/created`, `session/followup`, `session/updated`, `session/deleted`, `session/fork`? Start with required ones.
- Declare events in a module augmentation: `orbit/session/created`, `orbit/session/updated`, `orbit/session/deleted`, `orbit/session/followup`.
- Mount in spine.

### `orbit-llm` (`src/lib/harness/plugins/orbit-llm.ts`)
- `class OrbitLlm extends Service` key `orbit.llm`
- Replaces static `aiProviderRegistry`: `register(adapter, opts?)`, `list()`, `get(id)`, `unregister(id)`; `complete(request)` calls into providers by preset's `adapterId`; keep exported API in `src/lib/ai/providers.ts` delegating to ctx (`requestCompletion`).
- Built-in adapters mounted (openai-compatible, gemini) — moved out of static module into plugin.

### `orbit-tools` (`src/lib/harness/plugins/orbit-tools.ts`)
- `class OrbitTools extends Service` key `orbit.tools`
- Use cordis-compatible defineTool? DeepSeek's `defineTool` has DeepSeek-specific schema (path descriptors). For Phase 1, keep Orbit-native: adapter `toDshDefinition` converting Orbit `AgentToolDefinition` + output inference from return type.
- `register(tool: AgentTool, opts?)`, `unregister(name)`, `definitions()`, `execute(ctx, name, args)`; delegating to `agentToolRegistry`.
- Built-in task tools ported from `TASK_TOOLS`.

### `orbit-mcp` (`src/lib/harness/plugins/orbit-mcp.ts`)
- `class OrbitMcp extends Service` key `orbit.mcp`
- Mirrors `src/lib/mcp/registry.ts` semantics: `registerServer` (from SecureStore or passed), `sync`, `getStatus`, `getToolCount`.
- Depends on OrbitTools service; on sync, call `ctx.tools.register` for each mcp tool.
- Triggered by `tools/pre-execute`? Simpler: OrbitMcp.sync() called by agent (`ensureMcpTools`) and by Settings screen via `ctx.orbitMcp.sync()`.
- Effects: `ctx.on('orbit/agent/*')` not needed yet.

### `orbit-agent` (`src/lib/harness/plugins/orbit-agent.ts`)
- Minimal orbit agent plugin (class OrbitAgent extends Service key `orbit.agent`) — loop driving to next Step; subscribes to `orbit/agent/created`; uses OrbitTools/ctx + OrbitLlm. Not full DeepSeek AgentLoop parity yet.

### `HarnessScreen` (`src/app/(app)/harness.tsx`) — Phase 1
- Show real plugin tree from `AppContext.plugins()` (each with id/service key/type/status/tools count)
- Do **not** remove existing snapshot UI yet (backwards-compat) — new view.

## Phase 1 — Port Orbit → plugins

| Existing seam | New plugin | Notes |
|---|---|---|
| `aiProviderRegistry` | `orbit-llm` | Presets/adapterId wiring moves from module-level call to plugin method `register()`; settings.ts reads adapters via ctx |
| `agentToolRegistry` | `orbit-tools` | Built-ins move into plugin mount |
| `chat-store.ts` | `orbit-session` | Same ChatStore; ctx-facing accessors added |
| `mcp/registry.ts` | `orbit-mcp` | Wrapped against ctx.tools; effect unwinds |
| `ThemeProvider` (unchanged) | theme context independent of Cordis | |

## Exports for consumers (update)
```ts
// src/lib/ai/providers.ts
export const aiProviderRegistry = {
  register: (a, o) => void getAppContext()!.llm.register(a, o),
  unregister: (id) => getAppContext()!.llm.unregister(id),
  list: () => getAppContext()!.llm.list(),
  get: (id) => getAppContext()!.llm.get(id),
};
```
```ts
// src/lib/ai/tools.ts
export const agentToolRegistry = {
  register: (t) => getAppContext()!.tools.register(t),
  unregister: (n) => getAppContext()!.tools.unregister(n),
  get: (n) => getAppContext()!.tools.get(n),
  definitions: () => getAppContext()!.tools.definitions(),
  execute: (...) => ...,
};
```
```ts
// src/lib/chat.ts
export async function getOrbitSession(): Promise<OrbitSession> { ... }
```

## Tests
- Add `src/lib/harness/spine/index.spec.ts` — smoke: context created, plugins mounted, services registered, tear down via fiber.
- Add `src/lib/harness/plugins/*.spec.ts` — unit smoke for tools/llm/mcp/session adapters.
- Update `npm run typecheck`, `npm run lint`, `npx expo export`.

## Verification
- `npx tsc --noEmit` ✅
- `npx expo lint` ✅
- `npx expo export --platform android --no-bytecode` ✅
- Bundle metrics to capture: context creation time, tool registrations count, no runtime errors in simulator (`opencode`/ Metro).
