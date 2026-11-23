# Orbit

**Orbit Harness** — everything is a plugin, and MCP is the universal adapter.

A local-first Android agent for **tasks and reminders**. Accounts, tasks, and chat
history live in SQLite on the phone. The agent brain is an on-device Ollama server
by default; you can connect a cloud LLM with your own API key — there is no shared
Orbit server.

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
- Glassmorphism UI: frosted panels, ambient glows, and translucent surfaces
- Light / Dark / System color mode — flat warm-neutral design with a coral accent and serif headings; navigation lives in the left drawer (Recents, New chat)
- Multi-conversation chat history with per-chat delete and a slide-in history panel
- **Orbit Harness** registry for providers, tools, storage, and MCP servers
- Harness screen with live plugin status, MCP tool counts, manual sync, and the Cordis plugin tree (bhutu-app, bhutu-tools, bhutu-llm, bhutu-mcp, bhutu-agent)
- Observability: event-sourced session logs (fork/resume/replay) and granular telemetry (tool durations, token usage, cache hit rates)
- Policy checks: configurable approval gates (`allow`/`deny`/`ask`) and sandboxing rules for every tool call, with a per-agent consent layer
- **Agent permissions**: a risk-aware approval dialog with Allow once / Always allow / Deny, scoped SQLite grants, emergency stop, and a Control Room dashboard
- **ORBIT Desktop Companion**: explicit computer pairing over HTTPS, encrypted session tokens in SecureStore, and approved remote command execution
- Android runtime permissions for camera, microphone, location, and contacts, requested only after Orbit's own approval
- AI settings screen with provider presets, connection test, and secure key storage
- MCP server connections (HTTP endpoints + optional bearer token) with per-server sync status
- Runtime extension layer: skill registry, agent lifecycle hooks, and delegated subagent tasks
- Offline **local mode** for basic commands when no API key is configured

## Connect the AI brain

Open **Settings → AI BRAIN**, pick a provider, paste a key, and tap **Test**:

| Provider | Default model | Get a key |
| --- | --- | --- |
| DeepSeek | `deepseek-chat` | https://platform.deepseek.com/api-keys |
| OpenAI | `gpt-4.1-mini` | https://platform.openai.com/api-keys |
| Google Gemini | `gemini-2.5-flash` | https://aistudio.google.com/apikey |
| Anthropic | `claude-3-5-sonnet-20241022` | https://console.anthropic.com/ |
| Mistral | `mistral-large-latest` | https://console.mistral.ai/ |
| Hugging Face | your model | https://huggingface.co/settings/tokens |
| Ollama | `qwen2.5:0.5b` | (local — no key needed) |
| OpenRouter | `openai/gpt-4.1-mini` | https://openrouter.ai/keys |
| Custom | your model | any OpenAI-compatible endpoint |

The base URL and model are editable. The key is stored in encrypted SecureStore on
the device and sent only to the provider you choose. Chat messages go to that
provider; tasks and account data stay local.

By default Orbit links to Ollama running on the same device/container at
`http://127.0.0.1:11434/v1` with `qwen2.5:0.5b` — no key needed. If you already
saved other AI settings, tap **Connect on-device Ollama** in **Settings → AI BRAIN**
to switch back in one tap, then **Test connection** to verify.

For a keyless local LLM on another machine, switch **AI BRAIN → Local server**,
choose Ollama or Custom, and enter the OpenAI-compatible endpoint using that
machine's LAN IP (for example `http://192.168.1.20:11434/v1`). Start Ollama with
`OLLAMA_HOST=0.0.0.0:11434` and keep both devices on the same Wi-Fi. The Android
build allows cleartext HTTP only for this local connection flow.

If no provider or local server is configured, the agent runs in offline local mode
and understands commands like:

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

## Agent permissions and the Desktop Companion

Every agent tool call passes through one execution boundary. Orbit classifies the
action, shows the user what will happen, and only then asks the Permission Manager
for a scoped authorization. Nothing protected executes before the decision.

- **Risk levels.** Low-risk on-device task tools can run automatically. Medium-risk
  actions ask and may be saved. High-risk actions ask on every single run; the
  “Always allow” option is locked and can never be persisted for them.
- **Three decisions.** Allow once, Always allow (when the request permits it), and
  Deny. Closing the dialog cancels the request instead of silently approving it.
- **Exact scope.** Grants match the agent id, tool, project, category, and scope
  key. A grant for Master Agent never applies to a specialist or dynamic agent.
- **Revalidation.** The Permission Manager checks emergency stop, grant status,
  expiry, use count, and agent/tool/category scope immediately before execution.
  One-time approvals are consumed at that point.
- **Emergency stop.** Stops all agents, cancels pending approvals, invalidates
  issued authorizations, and persists across app restarts until resumed.
- **Audit trail.** Requests, decisions, grant use, revocations, blocked commands,
  Android permission failures, and paired devices are recorded in SQLite after
  redaction. Session tokens and secrets never enter chat or audit text.

Open **Settings → Agent Permissions** (also in the drawer) to see connected
computers, every registered agent, active and past grants, denials, emergency-stop
state, and the audit history. Grants can be revoked individually or per agent.

### Pairing a computer

Computer access is available only through **ORBIT Desktop Companion**:

1. Start the companion on the computer and open its pairing screen.
2. In Orbit, open **Agent Permissions → Connected computers → Pair**.
3. Enter a name, the HTTPS companion URL, and the short-lived pairing code.
4. The companion exchanges the code for a device session token. Orbit stores that
   token in Android Keystore-backed SecureStore and keeps only a fingerprint in
   SQLite.

The companion exposes `POST /orbit/pair` and `POST /orbit/execute`. Execution
requests use the paired bearer token and are subject to command blocklists,
workspace path restrictions, timeouts, and a separate high-risk approval for every
run. Loopback HTTP is allowed only for local development.

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

Android builds run automatically for `main` pushes and `v*` tags, but they only
upload CI artifacts. Publishing a public GitHub Release is **manual-only** and
requires an explicitly confirmed workflow run.

To publish a release:

1. Open **Actions → Android Build → Run workflow**.
2. Set `publish_release` to `true`.
3. Set `confirm_public_release` to `true`.
4. Enter a valid `release_tag` such as `v1.7.0`.
5. Run the workflow. It downloads and verifies the APKs/AAB from that same
   successful build, then creates the release.

Tag pushes and normal `main` builds never create, edit, or overwrite a release.
The release contains `ORBIT-debug.apk`, `ORBIT-release.apk`,
`ORBIT-release.aab`, and `build-info.txt`. Download the APK on your phone and
install it (allow "Install unknown apps" for your browser/file manager).

Releases page:

```text
https://github.com/What-if-Ajeeb/Orbit/releases
```

> The release APK is signed with the debug keystore when release-signing secrets
> are not configured. That is fine for testing and sideloading but not for
> publishing to the Play Store. For a Play Store build, use EAS Build with a
> production keystore.

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
      settings.tsx        # AI, MCP, reminders, permissions, account, data
      harness.tsx         # plugin dashboard (drawer entry)
      policy.tsx          # tool approval policy rules
      permissions.tsx     # agent consent control room + companion pairing
  components/             # Brand, Button, TaskItem, ChatBubble, AppSidebar, ...
    permissions/          # global approval dialog, host, pairing modal
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
    permissions/
      manager.ts          # request, grant, revalidation, emergency stop
      store.ts            # SQLite requests, grants, audit, devices, state
      executor.ts         # mandatory secure tool boundary
      classifier.ts       # tool → category, risk, target, command preview
      command-policy.ts   # blocked commands + path restrictions
      devices.ts          # companion pairing, token storage, execution
      android.ts          # runtime camera/mic/location/contacts requests
      computer-tool.ts    # computer_execute agent tool
      agents.ts           # master/specialist/dynamic identities
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
    db.ts                 # SQLite schema + migrations (v7)
    dates.ts              # formatting + natural-language date parsing
    hooks.ts              # agent lifecycle hooks + execution engine
    notifications.ts      # local notification scheduling
    skills.ts             # skill registry + capability executor
    subagents.ts          # subagent registry + delegated task store
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
- `skills`, `hooks`, `subagents`, `subagent_tasks` — runtime extension stores (v6)
- `permission_requests`, `permission_grants`, `permission_audit`, `permission_agents`, `paired_devices`, `permission_state` — agent consent, grants, audit, companion sessions, and emergency-stop state (v7)

Chats, messages, and tasks cascade-delete when their user is removed. Permission
records cascade with the user; paired-device tokens live separately in SecureStore.

## Notes

- Database file: `orbit.db` in the app's private SQLite directory.
- Reminders need notification permission. Android 13+ asks on the first reminder.
- Reminders are scheduled with Android's best-effort alarm delivery; battery
  optimizations can delay them slightly.
- Passwords are never stored in plain text. Signing out deletes the session row and
  the stored token.
- Permission approvals are enforced in code, not only in the UI. A denied or
  expired request cannot be retried by the model without a fresh dialog.
- Emergency stop is device-wide and persisted in SQLite. It cancels pending
  requests and invalidates approvals issued before the stop.
- Clear app storage (or reinstall) to reset all local accounts.
- Real email verification / password reset needs an email provider and network
  access; add that later if the app needs account recovery.
