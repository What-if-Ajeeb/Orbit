# Orbit

**Orbit Harness** — everything is a plugin, and MCP is the universal adapter.

A local-first Android agent for **tasks and reminders**. Accounts, tasks, and chat
history live in SQLite on the phone. The agent brain is a cloud LLM that you connect
with your own API key — there is no shared Orbit server.

Built with **Expo SDK 58**, **Expo Router**, **expo-sqlite**, **expo-secure-store**,
and **expo-notifications**.

## What's included

- Email + password sign up / sign in (PBKDF2-SHA256, 120,000 iterations, random salt)
- 30-day sessions; only a SHA-256 hash of the token is stored in SQLite
- Session token in the Android Keystore-backed `expo-secure-store`
- Agent chat that understands English and Hinglish
- Tool-using agent: create, list, update, complete, and delete tasks
- Local notifications for due dates and reminders, even when the app is closed
- Task list with quick-add (`pay bill tomorrow 5pm`), filters, and long-press delete
- App-wide navigation drawer with profile, AI status, and sign out
- Multi-conversation chat history with per-chat delete and a slide-in history panel
- **Orbit Harness** registry for providers, tools, storage, and MCP servers
- Harness screen with live plugin status, MCP tool counts, and manual sync
- AI settings screen with provider presets, connection test, and secure key storage
- MCP server connections (HTTP endpoints + optional bearer token) with per-server sync status
- Offline **local mode** for basic commands when no API key is configured

## Connect the AI brain

Open **Settings → AI BRAIN**, pick a provider, paste a key, and tap **Test**:

| Provider | Default model | Get a key |
| --- | --- | --- |
| OpenAI | `gpt-4.1-mini` | https://platform.openai.com/api-keys |
| Google Gemini | `gemini-2.5-flash` | https://aistudio.google.com/apikey |
| OpenRouter | `openai/gpt-4.1-mini` | https://openrouter.ai/keys |
| Custom | your model | any OpenAI-compatible endpoint |

The base URL and model are editable. The key is stored in encrypted SecureStore on
the device and sent only to the provider you choose. Chat messages go to that
provider; tasks and account data stay local.

Without a key, the agent runs in local mode and understands commands like:

```text
Add task pay electricity bill tomorrow 5pm
Remind me to call mom at 7pm
What's pending?
Complete 3
```

## Connect MCP tools

Orbit can mirror tools from any **MCP server that speaks Streamable HTTP**. Open
**Settings → MCP TOOLS → Add server**, enter the endpoint URL (for example
`https://mcp.example.com/mcp`) and an optional bearer token, then tap **Add**.
Orbit connects immediately and shows how many tools the server exposes.

- Toggle a server off to remove its tools from the agent without deleting it.
- Tap **Sync** to reconnect and refresh the tool list.
- The token is stored with the server config in encrypted SecureStore.
- MCP tools are only used in cloud AI mode; results are treated as untrusted data.

Servers whose names start with `mcp__` appear in the agent's tool list on the next
message (the list refreshes at most every five minutes, or immediately after a
manual sync).

## Orbit Harness: Everything is a Plugin and MCP

The agent core stays small and every capability is replaceable. The **Orbit Harness**
is the set of registries behind that idea — no Cordis runtime and no harness
dependency, just explicit seams:

- **Provider plugin** — `src/lib/ai/provider-registry.ts`. Presets in
  `settings.ts` point at an `adapterId`; `requestCompletion` resolves it.
- **Tool plugin** — `src/lib/ai/tool-registry.ts`. Built-in task tools live in
  `task-tools.ts`; the agent reads `listAgentTools()` every run.
- **Storage plugin** — `src/lib/chat.ts` registers chat stores; SQLite is the
  default via `getChatStore(db)`.
- **MCP plugin** — `src/lib/mcp/registry.ts` mirrors external MCP tools into the
  same tool registry under the `mcp__` prefix.

`src/lib/harness/` ties the registries together and powers the **Harness** screen
(**Harness** in the drawer), which shows the active provider, every registered
tool, the active store, and each MCP server's sync state.

Add a provider adapter and point a preset's `adapterId` at it:

```ts
import { aiProviderRegistry } from '@/lib/harness';

aiProviderRegistry.register({
  id: 'my-protocol',
  label: 'My protocol',
  complete: async ({ settings, messages, tools }) => {
    // return { text, toolCalls }
  },
});
```

Add a tool:

```ts
import { agentToolRegistry } from '@/lib/harness';
import { toolOk } from '@/lib/ai/tool-registry';

agentToolRegistry.register({
  definition: { name: 'my_tool', description: '...', parameters: { ... } },
  execute: async ({ db, userId }, args) => ({
    content: toolOk({ done: true }),
    trace: 'Ran my_tool',
  }),
});
```

Add a chat store with `registerChatStorePlugin(...)`, then activate it with
`setActiveChatStore('my-store')`. The full lifecycle, MCP caching, and security
rules are in **[`docs/HARNESS.md`](docs/HARNESS.md)**.

## Run on your Android phone

1. Install **Expo Go** from the Play Store.
2. Install dependencies and start the dev server:

   ```sh
   npm install
   npx expo start
   ```

3. Scan the QR code with Expo Go.

Phone and computer must be on the same Wi-Fi. If that is not possible, use a tunnel:

```sh
npx expo start --tunnel
```

> Local notifications work in Expo Go on Android. The installable APK below is the
> most reliable way to use reminders and the agent.

## Installable APK (GitHub Releases)

Every version tag builds a signed release APK in GitHub Actions and attaches it to
the GitHub Release. Download it on your phone and install it (allow "Install
unknown apps" for your browser/file manager).

```sh
git tag v1.2.0
git push origin v1.2.0
```

Releases page:

```text
https://github.com/What-if-Ajeeb/Orbit/releases
```

You can also start a build manually: **Actions → Android APK Release → Run
workflow**. Builds take roughly 10–20 minutes.

> The release APK is signed with the debug keystore, which is fine for testing and
> sideloading but not for publishing to the Play Store. For a Play Store build,
> use EAS Build with a production keystore.

## Scripts

```sh
npm start        # start Metro / Expo dev server
npm run android  # open on a connected Android device or emulator
npm run lint     # ESLint
npm run typecheck
```

## Project structure

```text
src/
  app/                    # every file is a route (Expo Router)
    _layout.tsx           # SQLite + session providers, notifications, protected routes
    sign-in.tsx
    sign-up.tsx
    (app)/
      _layout.tsx         # bottom tabs + app sidebar + notification taps
      index.tsx           # Today dashboard
      chat.tsx            # agent conversation + chat history panel
      tasks.tsx           # task list + quick add
      settings.tsx        # AI, MCP, reminders, account, data
      harness.tsx         # plugin dashboard (drawer entry)
  components/             # Brand, Button, TaskItem, ChatBubble, AppSidebar, ...
  context/
    auth.tsx              # session state + sign in/up/out
    sidebar.tsx           # app-wide drawer state
  lib/
    ai/
      agent.ts            # tool-calling loop (max 6 rounds)
      provider-registry.ts # provider plugin seam
      providers.ts        # OpenAI-compatible + Gemini adapters
      tool-registry.ts    # tool plugin seam
      task-tools.ts       # built-in task tools
      tools.ts            # registers built-ins + agent-facing helpers
      prompt.ts           # system prompt with local date/time
      local-agent.ts      # offline fallback parser
      settings.ts         # provider presets + SecureStore config
    harness/
      index.ts            # plugin facade + live snapshot builder
      types.ts            # HarnessPlugin + HarnessSnapshot types
    mcp/
      client.ts           # Streamable HTTP MCP client
      registry.ts         # mirrors MCP tools into the agent registry
      settings.ts         # MCP server config in SecureStore
    auth.ts               # hashing, sessions, account queries
    chat-store.ts         # ChatStore interface + SQLite implementation
    chat.ts               # chat store plugin registry (SQLite default)
    db.ts                 # SQLite schema + migrations (v3)
    dates.ts              # formatting + natural-language date parsing
    notifications.ts      # local notification scheduling
    tasks.ts              # task CRUD + reminder sync
    validation.ts
  theme.ts
```

New screens added under `src/app/` become routes automatically.
Architecture and plugin guide: [`docs/HARNESS.md`](docs/HARNESS.md).

## Data model

- `users`, `sessions` — local accounts
- `tasks` — title, notes, due/remind timestamps, priority, status, notification id
- `conversations` — one row per chat, ordered by last update
- `messages` — persisted agent messages linked to a conversation, with tool traces

Chats, messages, and tasks cascade-delete when their user is removed.

## Notes

- Database file: `orbit.db` in the app's private SQLite directory.
- Reminders need notification permission. Android 13+ asks on the first reminder.
- Reminders are scheduled with Android's best-effort alarm delivery; battery
  optimizations can delay them slightly.
- Passwords are never stored in plain text. Signing out deletes the session row and
  the stored token.
- Clear app storage (or reinstall) to reset all local accounts.
- Real email verification / password reset needs an email provider and network
  access; add that later if the app needs account recovery.
