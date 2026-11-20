# Orbit Harness: Everything is a Plugin and MCP

Orbit is a local-first agent. Its core is deliberately small, and every capability
that can vary is a plugin with the same lifecycle: register, describe, run.

The **Orbit Harness** is not a framework or a runtime dependency. It is the set of
explicit registries Orbit already uses, plus a read-only snapshot that powers the
**Harness** screen. There is no Cordis runtime and no harness package — just seams.

## What is a plugin?

| Kind | What it provides | Registration API | Built in |
| --- | --- | --- | --- |
| **AI provider** | One wire protocol (request + tool-call parsing) | `aiProviderRegistry.register` | `openai-compatible`, `gemini` |
| **Tool** | A model-callable function | `agentToolRegistry.register` | `create_task`, `list_tasks`, `complete_task`, `update_task`, `delete_task` |
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
                 └─ executeTool()      agentToolRegistry
                      ├─ task tools    src/lib/ai/task-tools.ts
                      └─ mcp__ tools   src/lib/mcp/registry.ts
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
2. **Local first.** Tasks, accounts, conversations, provider keys, and MCP tokens
   stay on the device. Only chat traffic leaves for the chosen provider.
3. **Failures are contained.** A provider error, MCP error, or tool error becomes a
   trace/reply, never a crashed screen.
4. **Every capability is replaceable.** If a feature cannot be registered as a
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
src/lib/mcp/
  client.ts           Streamable HTTP client
  registry.ts         mirrors MCP tools, TTLs, statuses
  settings.ts         server config in SecureStore
src/app/(app)/harness.tsx   plugin dashboard
```
