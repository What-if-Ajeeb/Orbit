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

## How a message flows

```text
chat.tsx
  └─ runAgent()                        src/lib/ai/agent.ts
       ├─ local mode (no API key)      src/lib/ai/local-agent.ts
       └─ cloud mode
            ├─ ensureMcpTools()        src/lib/mcp/registry.ts
            │    └─ Streamable HTTP    src/lib/mcp/client.ts
            ├─ buildSystemPrompt()     src/lib/ai/prompt.ts
            ├─ requestCompletion()     src/lib/ai/providers.ts
            │    └─ provider adapter   aiProviderRegistry
            └─ tool loop (max 6)
                 └─ secureExecuteTool() src/lib/permissions/executor.ts
                      ├─ classify + ask  permissionManager
                      ├─ revalidate      grants / emergency stop
                      └─ executeTool()  agentToolRegistry
                           ├─ task tools src/lib/ai/task-tools.ts
                           ├─ computer   permission/computer-tool.ts
                           └─ mcp__ tools src/lib/mcp/registry.ts
```

The chat store is resolved separately by the screens through `getChatStore(db)`, so
storage can change without touching the agent.

## AI provider plugins

A provider adapter translates Orbit's neutral messages and tool definitions into
one wire protocol, then parses the reply back into `{ text, toolCalls }`.

```ts
import { aiProviderRegistry } from '@/lib/harness';

aiProviderRegistry.register({
  id: 'my-protocol',
  label: 'My protocol',
  complete: async ({ settings, messages, tools }) => {
    // Call the endpoint, then return a neutral turn.
    return { text: '…', toolCalls: [] };
  },
});
```

Presets in `src/lib/ai/settings.ts` point at an adapter id. Adding a preset is a
settings change; adding a protocol is a one-file plugin.

## Model-agnostic routing

Orbit does not tie itself to a single model family. Every provider speaks the
same OpenAI-compatible wire protocol (`POST /v1/chat/completions` with Bearer
token auth), so adding a new provider is just a preset with a base URL and
default model:

| Provider | Default model | Endpoint | Notes |
| --- | --- | --- | --- |
| DeepSeek | `deepseek-chat` | `https://api.deepseek.com/v1` | Recommended default. |
| OpenAI | `gpt-4.1-mini` | `https://api.openai.com/v1` | Official OpenAI API. |
| Google Gemini | `gemini-2.5-flash` | `https://generativelanguage.googleapis.com/v1beta` | Gemini via OpenAI-compatible shim. |
| Anthropic | `claude-3-5-sonnet-20241022` | `https://api.anthropic.com/v1` | Via OpenAI-compatible proxy (e.g. LiteLLM). |
| Mistral | `mistral-large-latest` | `https://api.mistral.ai/v1` | OpenAI-compatible endpoint. |
| Hugging Face | your model | `https://api-inference.huggingface.co/v1/` | HF Inference API. |
| Ollama | `llama3` | `http://localhost:11434/v1` | Local Ollama instance — no key needed. |
| OpenRouter | `openai/gpt-4.1-mini` | `https://openrouter.ai/api/v1` | One key, many models. |
| Custom | your model | any URL | Any OpenAI-compatible endpoint. |

The base URL and model are editable in **Settings → AI BRAIN**, so you can point
Orbit at a self-hosted LiteLLM, vLLM, or any other OpenAI-compatible server.
Chat messages go only to the provider you choose; tasks and account data stay
local on the device.

Without a key, the agent runs in local mode and understands commands like:

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
