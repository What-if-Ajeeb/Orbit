# Orbit Harness: Everything is a Plugin and MCP

Orbit is a local-first agent. Its core is deliberately small, and every capability
that can vary is a plugin with the same lifecycle: register, describe, run.

The **Orbit Harness** is not a framework or a runtime dependency. It is the set of
explicit registries Orbit already uses, plus a read-only snapshot that powers the
**Harness** screen.

> **Cordis spine (Phase 1 in progress):** Orbit now mounts the vendored **Cordis**
> plugin tree (`cordis` package, see `vendor/README.md` and
> `src/lib/harness/spine/`). The five Orbit plugins below are available on the
> context: `session`, `tools`, `llm`, `mcp`, `agent`. Static APIs are unchanged
> while onboarding.

DeepSeek Harness's larger plan is in
[`docs/deepseek-harness-phase1.md`](../.agents/deepseek-harness-phase1.md)
(`docs/` -> `.agents/deepseek-harness-phase1.md`).

**Phase 2 — Event surfaces.** Orbit now emits typed Cordis-side events from its
services: `orbit/tools/register`, `orbit/tools/unregister`, `orbit/tools/change`
(on every registry mutation), and `orbit/agent/status`, `orbit/agent/created`,
`orbit/agent/step`, `orbit/agent/request`, `orbit/agent/turn-stopping` (agent
lifecycle markers). The legacy `session/created`, `session/deleted` still emit
from `OrbitSession`. The Harness screen reads live state directly from
`ctx.tools.definitions()`, `ctx.llm.list()`, `ctx.mcp.statuses`, and the
`orbit-agent` marker — future consumers can intercept via Cordis waterfall
events instead of the legacy snapshot API.

**Phase 3 — Layers/profiles stubs.** `packages/orbit/dsh-app` (app bundle,
`dsh.bundle.patch` → `cordis.patch.yml` mounting Orbit's five spine plugins),
plus profile stubs `packages/orbit/bhutu-web-app`, `packages/orbit/bhutu-headless`,
`packages/orbit/bhutu-sdk-app` (`dsh.profile.bundles: ["@orbit/bhutu-app"]`). Root
`package.json` gained `"workspaces": ["packages/**/*"]`; `npm install` linked
them. `OrbitApp` (`bhutu-app/src/index.ts`) is the standalone plugin factory that
mounts the five plugins; the in-app boot still mounts them directly today.

## What is a plugin?

| Kind | What it provides | Registration API | Built in |
| --- | --- | --- | --- |
| **AI provider** | One wire protocol (request + tool-call parsing) | `aiProviderRegistry.register` | `openai-compatible`, `gemini` |
| **Tool** | A model-callable function | `agentToolRegistry.register` | `create_task`, `list_tasks`, `complete_task`, `update_task`, `delete_task`, `computer_execute` |
| **Chat store** | Conversation persistence | `registerChatStorePlugin` | `sqlite` |
| **MCP server** | External tools over Streamable HTTP | `Settings → MCP TOOLS` | none — user configured |

A plugin can be added without editing the agent loop, the chat screen, or the other
plugins. The agent only knows the registries.

## Plugin platform (separate lifecycle layer)

`src/lib/plugins/` and `src/context/plugins.tsx` add a second, manifest-driven
plugin layer. It is distinct from the four harness seams above: it owns its own
lifecycle, permission grants, SQLite tables and Plugin Manager UI. The Cordis
core services listed in the note at the top are adopted as read-only records;
this layer does not remount them.

Implemented behavior:

- Version 1 JSON manifests are validated; the bundled catalog includes the
  Cordis core service metadata, built-in diagnostics and
  `plugins/example-plugin`.
- Install, enable, disable, update and uninstall are explicit state transitions
  with dependency checks, lifecycle hook timeouts, update backups and rollback.
- Permissions are default-deny and flow through `PluginApprovalHost`; there is no
  "Approve all" control. Trust levels and `verified` flags are advisory only.
- Tools are namespaced as `plugin__<slug>__<name>` and require `ai.invoke`.
  Storage and settings are per-plugin; events are typed and size-limited.
- Configured MCP servers are mirrored into synthetic `mcp.server.<slug>` plugins.
  The tool gate is installed in the constructor and denies tools until records
  are synced; it requires both `mcp.connect` and `ai.invoke`, and revocations are
  sticky across re-sync.
- `src/lib/cordis-tools.ts` exposes read-only `cordis_plugin_list`,
  `cordis_plugin_inspect` and `cordis_plugin_permission_audit` agent tools.
- `src/lib/plugins/demand.ts` resolves a task into the minimum trusted plugin
  plan. `orbit_plugin_discover` is read-only; `orbit_plugin_request` asks the
  existing `PluginApprovalService` for explicit consent before calling
  `PluginRegistry.install`, `update`, `enable` or permission grants. Reused,
  installed, updated, denied and failed attempts are recorded in plugin KV
  storage and shown in the Plugin Manager.
- Legacy hook scripts are disabled: `HookEngine.runHookCode()` throws, stored
  hook rows are never evaluated, and failed `executeHook()` results are ignored
  by the agent.

Current limitations: third-party plugins are declarative only (no downloaded
code execution), no remote marketplace or unknown-manifest fetch, `notifications`/`credentials` SDK adapters
are unavailable, there is no SDK file API or `sdk.mcp`, and toolbar/context
actions have no global host. Plugin-specific
Vitest files exist under `src/lib/plugins/__tests__/`; no results are asserted
here. See [`docs/PLUGIN_ARCHITECTURE.md`](PLUGIN_ARCHITECTURE.md) and the related
`docs/PLUGIN_*.md` files for the implemented details.

## How a message flows

```text
chat.tsx / agents/[agentId]/index.tsx
  └─ AgentChatView                     src/components/AgentChatView.tsx
       └─ runAgent()                   src/lib/ai/agent.ts
            ├─ loadAgentConfig()       src/lib/agent-settings.ts
            │    └─ filterAllowedTools()
            ├─ offline local mode      src/lib/ai/local-agent.ts
            │    (no provider configured)
            └─ configured provider (cloud or local server)
                 ├─ ensureMcpTools()   src/lib/mcp/registry.ts
                 │    └─ Streamable HTTP src/lib/mcp/client.ts
                 ├─ buildSystemPrompt() src/lib/ai/prompt.ts
                 │    └─ agent instructions + memory
                 ├─ requestCompletion() src/lib/ai/providers.ts
                 │    └─ provider adapter aiProviderRegistry
                 └─ tool loop (max 6)
                      └─ secureExecuteTool() src/lib/permissions/executor.ts
                           ├─ classify + ask  permissionManager
                           ├─ revalidate      grants / emergency stop
                           └─ executeTool()  agentToolRegistry
                                ├─ task tools src/lib/ai/task-tools.ts
                                ├─ computer   permission/computer-tool.ts
                                ├─ google_*   src/lib/connections/tools.ts
                                └─ mcp__ tools src/lib/mcp/registry.ts
```

The chat store is resolved separately by the screens through `getChatStore(db)`, so
storage can change without touching the agent. Agent-scoped conversations, message
metadata (attachments and tool events), and agent configs live in SQLite v13.

## Per-agent chat and connected tools

`AgentChatView` is the only chat surface. The Master Agent tab and each
`/agents/<id>` screen render it with a different identity and scope; it loads only
conversations for that agent, sends the agent id to `runAgent`, and persists tool
events with the assistant message. Attachments are converted in
`src/lib/chat-attachments.ts`: picked image bytes stay in memory for the current
request, and only redacted text previews and metadata reach SQLite or history.

Per-agent instructions, memory, and tool patterns come from `src/lib/agent-settings.ts`.
The default is `selected` mode with a small safe allowlist. `runAgent` filters every
registered tool through that allowlist before the model sees it, denies unauthorized
model-issued calls, and forwards its `AbortController` signal into tool execution.
Streaming text and tool events are rendered live; the final persisted reply is loaded
back into the visible message list so it survives the end of the stream.

Google tools are side-effect registrations from `src/lib/connections/tools.ts` into
the existing `agentToolRegistry`. They call the real Gmail/Calendar/Drive wrappers in
`src/lib/connections/api.ts`, using OAuth tokens obtained by
`src/lib/connections/google.ts` and stored per user in SecureStore. Missing config or
expired credentials produce explicit setup/expired states; no connected state is
synthesized, and token values are redacted from logs, UI messages, and full tool
results. Both reads and writes are classified as sensitive and go through
`secureExecuteTool`, so content from a connected account is not exposed without an
explicit approval or an existing grant for that exact tool. Plugin JavaScript never
receives credentials: the plugin SDK credential adapter still throws.

Marketplace, Connections, Tool Permissions, and Approvals are views over existing
registries and permission stores. They do not start a second agent loop, MCP runtime,
plugin loader, or approval host. Third-party plugins remain bundled declarative
manifests; MCP servers are mirrored as synthetic plugins with the same `mcp.connect`
plus `ai.invoke` gate and sticky revocations.

## AI provider plugins

A provider adapter translates Orbit's neutral messages and tool definitions into
one wire protocol, then parses the reply back into `{ text, toolCalls }`.

```ts
import { aiProviderRegistry } from '@/lib/harness';

aiProviderRegistry.register({
  id: 'my-protocol',
  label: 'My protocol',
  complete: async ({ settings, messages, tools }, options = {}) => {
    // options.onTextDelta enables token streaming when the protocol supports it.
    // options.signal cancels an in-flight request.
    return { text: '…', toolCalls: [] };
  },
});
```

Presets in `src/lib/ai/settings.ts` point at an adapter id. Adding a preset is a
settings change; adding a protocol is a one-file plugin.

## Model-agnostic routing

Orbit does not tie itself to a single model family. Each provider has its own
adapter: OpenAI-compatible (`POST /chat/completions`), native Gemini, or native
Ollama (`GET /api/tags` + `POST /api/chat`). Adding a new protocol is a one-file
plugin; adding a preset is a settings change.

| Provider | Default model | Endpoint / discovery | Notes |
| --- | --- | --- | --- |
| DeepSeek | `deepseek-chat` | `https://api.deepseek.com/v1` | OpenAI-compatible. |
| OpenAI | `gpt-4.1-mini` | `https://api.openai.com/v1` | Official OpenAI API. |
| Google Gemini | `gemini-2.5-flash` | `https://generativelanguage.googleapis.com/v1beta` | Native Gemini adapter. |
| Anthropic | `claude-3-5-sonnet-20241022` | `https://api.anthropic.com/v1` | Via OpenAI-compatible proxy (e.g. LiteLLM). |
| Mistral | `mistral-large-latest` | `https://api.mistral.ai/v1` | OpenAI-compatible endpoint. |
| Hugging Face | your model | `https://api-inference.huggingface.co/v1/` | HF Inference API. |
| Ollama | discovered via `/api/tags` | `http://127.0.0.1:11434` | Native on-device API; no key. |
| OpenRouter | `openai/gpt-4.1-mini` | `https://openrouter.ai/api/v1` | One key, many models. |
| Custom | your model | any URL | Any OpenAI-compatible endpoint. |

The base URL and model are editable in **Settings → AI BRAIN**. The **Local server**
mode stores `mode: 'local'` and skips the API key requirement. Fresh installs point
to `onDeviceOllamaSettings()` (`http://127.0.0.1:11434`) with an empty model: the
Settings screen calls `GET /api/tags`, shows status and retry controls, and lets you
pick a model that is actually installed. **Connect on-device Ollama** performs
discovery and auto-selects the first model. Chat then uses `POST /api/chat`, with
NDJSON streaming and a Stop button in the Chat screen.

Android cleartext HTTP is scoped by `plugins/withLocalhostCleartext.js` to
`127.0.0.1` / `localhost` only; all other cleartext traffic is denied. Ollama is
not exposed to the LAN. Native manifest/resource changes require a new APK; OTA
updates cannot change them.

If no provider or local server is configured, the agent runs in offline local mode
and understands commands like:

```text
Add task pay electricity bill tomorrow 5pm
Remind me to call mom at 7pm
What's pending?
Complete 3
```

## Tool plugins

Tools own their schema and implementation. Registering a tool makes it available to
the next agent run.

```ts
import { agentToolRegistry } from '@/lib/harness';
import { toolOk } from '@/lib/ai/tool-registry';

agentToolRegistry.register({
  definition: {
    name: 'my_tool',
    description: 'Does one useful thing.',
    parameters: { type: 'object', properties: {} },
  },
  execute: async ({ db, userId }, args) => ({
    content: toolOk({ done: true }),
    trace: 'Ran my_tool',
  }),
});
```

Built-in tools are registered from `src/lib/ai/tools.ts` when the module loads.
MCP tools are registered dynamically in the same registry, which is why the agent
needs no special case for them.

## Permission boundary

`agentToolRegistry` is a registry, not an approval system. The agent loop calls
`secureExecuteTool()` from `src/lib/permissions/executor.ts` for every tool, and
that boundary is the only path from the model to an implementation.

```text
tool call
  → classifyToolAction()       category, risk, target, redacted preview
  → permissionManager.request  existing grant, auto-approval, or dialog
  → command/path checks        hard blocks apply even after approval
  → permissionManager.begin    emergency stop, expiry, scope, use count
  → executeTool()
  → finishExecution()          completed / failed audit entry
```

The global `PermissionHost` in the authenticated app layout resolves pending
requests. Grants are keyed by user, agent, tool, category, project, and scope key;
a different agent never inherits them. High-risk requests cannot create persistent
grants. One-time grants are consumed at `beginExecution()`; persistent grants expire
after 30 days and can be revoked from **Agent Permissions**.

## Chat store plugins

```ts
import { registerChatStorePlugin, setActiveChatStore } from '@/lib/harness';

registerChatStorePlugin({
  id: 'memory',
  label: 'In-memory',
  description: 'Ephemeral store for demos and tests.',
  create: () => ({
    listConversations: async () => [],
    getConversation: async () => null,
    createConversation: async () => {
      /* … */
    },
    listMessages: async () => [],
    addMessage: async () => {
      /* … */
    },
    deleteConversation: async () => {},
    clearAllChat: async () => {},
  }),
});

setActiveChatStore('memory');
```

SQLite is registered as the default. The active store is cached per database
instance, so switching providers does not leak stale conversations.

## MCP servers

MCP is the universal adapter: an external server describes its tools, and Orbit
mirrors them into the agent tool registry.

1. Open **Settings → MCP TOOLS → Add server**.
2. Enter the Streamable HTTP endpoint (for example `https://mcp.example.com/mcp`).
3. Optionally add a bearer token. It is stored with the server config in encrypted
   SecureStore.
4. Tap **Add** or **Sync**. The card shows the tool count or the connection error.

Naming and caching:

- Exposed names are prefixed: `mcp__<server>__<tool>`, sanitized and capped at 64
  characters. Collisions get a numeric suffix.
- Tools refresh at most every **5 minutes**, or immediately after a manual sync.
- HTTP sessions are reused for **30 minutes** when the URL and token are unchanged.
- Timeouts are 15s connect, 20s list, and 60s per tool call.

Security rules:

- MCP results are **untrusted external data**. The system prompt tells the model to
  treat them as information, never as instructions.
- A failing server cannot block chat: sync errors are reported per server and the
  remaining tools stay available.
- Chat text goes only to the configured AI provider. MCP requests go only to the
  server you configured.

## The Harness screen

The **Harness** entry in the app drawer shows a live snapshot of all four plugin
kinds: the active provider, registered tools, the active chat store, and every MCP
server with its sync state. **Sync MCP** reconnects servers; row taps deep-link to
Settings.

The snapshot is built by `buildHarnessSnapshot()` and loaded by
`loadHarnessSnapshot()` in `src/lib/harness/index.ts`.

## Verification

For harness or plugin-platform changes, run the repository checks described in
[`docs/OPERATIONS.md`](OPERATIONS.md):

```sh
npx tsc --noEmit
npx expo lint
npm test
npx expo export --platform android --no-bytecode
```

The Vitest suite includes the plugin-specific tests under
`src/lib/plugins/__tests__/`. This document does not assert their results.

## Invariants

These are product rules, not just implementation details:

1. **No implicit task creation.** Only explicit task or reminder phrasing creates
   something; a pasted file name or email excerpt is not a task.
2. **No execution before consent.** Every protected tool call blocks on the
   Permission Manager. A denial, cancellation, expiry, emergency stop, or scope
   mismatch becomes a contained tool error — never a silent execution.
3. **Local first.** Tasks, accounts, conversations, provider keys, permission
   records, and MCP tokens stay on the device. Only chat traffic leaves for the
   chosen provider.
4. **Failures are contained.** A provider error, MCP error, or tool error becomes a
   trace/reply, never a crashed screen.
5. **Every capability is replaceable.** If a feature cannot be registered as a
   plugin, it does not belong in the harness.

## File map

```text
src/lib/harness/
  index.ts            plugin facade, snapshot builder, built-in imports
  types.ts            HarnessPlugin, HarnessSnapshot, counts
src/lib/ai/
  provider-registry.ts
  providers.ts        openai-compatible + gemini adapters
  tool-registry.ts
  task-tools.ts       built-in task tools
  tools.ts            registers built-ins, agent-facing helpers
src/lib/chat.ts       chat store registry + SQLite default
src/lib/permissions/
  manager.ts          consent state, grants, emergency stop
  executor.ts         mandatory secure tool boundary
  classifier.ts       risk + action preview mapping
  store.ts            SQLite requests, grants, audit, devices
  devices.ts          Desktop Companion pairing + execution
  computer-tool.ts    computer_execute tool
src/lib/mcp/
  client.ts           Streamable HTTP client
  registry.ts         mirrors MCP tools, TTLs, statuses
  settings.ts         server config in SecureStore
src/app/(app)/harness.tsx   plugin dashboard
src/app/(app)/permissions.tsx  agent consent control room
```
