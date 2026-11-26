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
- Sidebar-first workspace with a collapsible drawer, six primary destinations, a grouped Pinned plugin tree, readable chat recents, local account switching, and a persistent New chat action
- Exactly three customizable bottom-navigation slots with reordering, local persistence, restore defaults, and fallback for destinations whose plugin is unavailable
- Typed Agent Action Cards for email, files, git and calendar: exact target/payload preview, explicit approval, real execution results, and activity logging
- Projects overview built from real stored conversations, tasks, artifacts, files and workflow runs — no placeholder projects
- Light / Dark / System color mode — flat warm-neutral design with a coral accent and serif headings; navigation lives in the left drawer
- Multi-conversation chat history with per-chat delete and a slide-in history panel
- Responsive tablet workspace: phones keep the existing portrait UI, portrait tablets use the overlay drawer, landscape tablets get a persistent sidebar, and large landscape tablets can show a resizable Context panel
- Individual AI agents with dedicated chats, instructions/memory, and per-agent tool allowlists
- Image and text-document attachments, streaming replies, cancellation, retry, and offline/local states
- Config-driven Google connections (Gmail, Calendar, Drive) using real OAuth and Keystore-backed tokens; unconfigured integrations show a setup state, never a fake “connected” state
- Tool Marketplace, Connected Accounts, Tool Permissions, and Tool Approvals screens that reuse the existing plugin, MCP, and permission runtimes
- **Orbit Harness** registry for providers, tools, storage, and MCP servers
- Harness screen with live plugin status, MCP tool counts, manual sync, and the Cordis plugin tree (bhutu-app, bhutu-tools, bhutu-llm, bhutu-mcp, bhutu-agent)
- Observability: event-sourced session logs (fork/resume/replay) and granular telemetry (tool durations, token usage, cache hit rates)
- Policy checks: configurable approval gates (`allow`/`deny`/`ask`) and sandboxing rules for every tool call, with a per-agent consent layer
- **Agent permissions**: a risk-aware approval dialog with Allow once / Always allow / Deny, scoped SQLite grants, emergency stop, and a Control Room dashboard
- **ORBIT Desktop Companion**: explicit computer pairing over HTTPS, encrypted session tokens in SecureStore, and approved remote command execution
- Android runtime permissions for camera, microphone, location, and contacts, requested only after Orbit's own approval
- AI settings screen with provider presets, connection test, and secure key storage
- MCP server connections (HTTP endpoints + optional bearer token) with per-server sync status
- Runtime extension layer: skill registry, reviewed built-in lifecycle hooks, and delegated subagent tasks (legacy hook scripts are disabled)
- **Plugin platform**: declarative manifests, default-deny permissions, namespaced tools/storage, and a Plugin Manager (`Plugins` in the drawer)
- **Android mobile sandbox** (Android-only): backend-only Rust policy core in an isolated Android service, owned from RN through an Expo Module. It has no screen, drawer item, setting, or branding. See [`docs/MOBILE_SANDBOX.md`](docs/MOBILE_SANDBOX.md).
- Offline **local mode** for basic commands when no API key is configured

## Tablets and landscape

The phone UI is unchanged. A device is treated as a tablet when its shorter screen
side is at least 600 density-independent pixels; phones stay locked to portrait
while tablets may rotate.

- **Tablet portrait** keeps one workspace area and the existing overlay drawer.
- **Landscape tablets** show a persistent left sidebar with Chats, Projects,
  Plugins, Marketplace, Buddy, Settings, the Pinned tree, Recents, account actions
  and New chat. The bottom bar is hidden; the sidebar can collapse to an icon rail.
- **Large landscape tablets** (width at least 1024) can show a collapsible,
  resizable **Context** panel with chat history, approvals and open tasks. The
  sidebar, workspace and panel scroll independently.

Pin an installed plugin from the Plugins screen with the star control, or use
**Pinned → Pin plugin** in the sidebar. Pinned shortcuts appear in two collapsible
groups — **Everything** and **More Plugins** — with nested connector rows, an
active-plugin highlight, drag handles for reordering and a long-press menu for
unpinning or moving between groups. Pin membership, order and collapse state are
persisted with the existing SecureStore/localStorage preference pattern; only
stable plugin IDs and group IDs are stored. Labels, icons and `/plugin/<id>`
routes are resolved from the live plugin snapshot, so pins never install or
duplicate plugins. Sidebar collapse, Context visibility and panel width are also
persisted locally.

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
| Ollama | discovered at runtime | (local — no key needed) |
| OpenRouter | `openai/gpt-4.1-mini` | https://openrouter.ai/keys |
| Custom | your model | any OpenAI-compatible endpoint |

The base URL and model are editable. The key is stored in encrypted SecureStore on
the device and sent only to the provider you choose. Chat messages go to that
provider; tasks and account data stay local.

### On-device Ollama

Fresh installs point at the **native** Ollama API on the same physical phone:

```text
http://127.0.0.1:11434
```

There is deliberately no hardcoded model. Tap **Connect on-device Ollama** in
**Settings → AI BRAIN** and Orbit will:

1. Call `GET /api/tags` to discover the models actually installed on the phone.
2. Show connection status, retry controls, and a picker of discovered models.
3. Auto-select the first installed model on one-tap connect.
4. Use `POST /api/chat` for chat — `stream:false` for quick checks and
   `stream:true` for live token output in the Chat screen. The **Stop** button
   cancels an in-flight generation.

The active Ollama model receives the same system prompt as cloud providers,
including the active Buddy/Kiko personality. Existing cloud providers and manual
switching are preserved.

`127.0.0.1` means **the phone running Orbit**, not your laptop or the emulator
host. Android's network security config permits cleartext HTTP only for
`127.0.0.1` / `localhost`; all other cleartext traffic is denied. Do not expose
Ollama to your LAN or the public internet. A remote Ollama server needs HTTPS or
a custom scoped build — it is not enabled by default.

Native Android changes (the manifest `INTERNET` permission and the network
security resource) require a **new APK build and install**. An OTA JS update
cannot change native Android configuration.

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

## Agent chats, connections, and tool discovery

Open **AI Agents** in the drawer to chat with a specific built-in or dynamic agent.
Each agent keeps its own conversations in SQLite, with a shared **Conversations**
screen for search and deletion. **Tools and memory** on an agent screen controls its
system-prompt instructions, remembered context, and tool allowlist. New agents start
with a small safe tool list; an explicit `all` mode is available but is never the
default.

Chat supports image and small text-document attachments. Image bytes are used only
for the current model request; stored message metadata keeps redacted text previews
instead of secrets. Streaming is shown live where the provider supports it, and
**Stop**, **Retry**, and offline/error states use the existing agent loop and
`AbortController`.

Google account tools are opt-in and config-driven. Set
`EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (optionally
`EXPO_PUBLIC_GOOGLE_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_REDIRECT_URI`) for a
development build. **Connections** then performs a real OAuth code + PKCE flow,
stores tokens per user in SecureStore, and can refresh, disconnect, and revoke them.
Both reading and changing connected-account content require explicit approval;
repeated calls of the same exact tool can reuse that saved grant. Without that
config, Gmail/Calendar/Drive show a setup state and their agent tools fail closed.

**Marketplace** browses the bundled declarative plugin catalog, MCP tools, and
connected-account actions. It does not download or execute remote plugin code.
**Tool permissions** reviews grants, policy rules, and agent allowlists; **Approvals**
shows pending sensitive requests. Both reuse the same global permission and approval
surfaces as the rest of Orbit.

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

### Agent Action Cards

When an agent proposes a sensitive action it creates a durable draft card; it never
sends, writes, deletes, or executes anything by itself. The card shows the exact
target and payload. The user must approve that exact payload, then explicitly
execute it. Editing a draft or approved card changes its fingerprint, cancels any
pending request, and invalidates the approval. Execution revalidates policy,
permissions and stop state immediately before the single real tool call. Results,
errors and outcomes are stored with the card and appended to the hash-linked
activity journal.

Built-in typed integrations cover Gmail send, file trash/restore, git status/diff/
log/branch/fetch/commit/push through `computer_execute`, and calendar create/update.
New typed integrations can register through `registerAgentActionIntegration()`;
each declares its own validation, exact arguments and approval requirement, but
none can bypass the shared permission executor.

The floating bottom pill appears only on main-level screens (Chat, Tasks, Make,
Marketplace and the other top-level destinations). Detail screens — an individual
conversation, task/project/plugin detail, Settings and its nested pages, connected
tools and approval flows — use the full screen instead. The pill is centered above
the safe-area/system navigation inset, reserves space for main-screen content once,
and steps aside while the keyboard is open so a composer is never covered.

Use **Settings → Navigation** to customize the three bottom slots. Every
destination — including the built-ins — can be picked, reordered, removed from a
slot, and restored to defaults. Only stable IDs are persisted; unavailable plugin
destinations fall back to built-ins without breaking deep links. Duplicate
assignments are swapped automatically, so the three slots always stay unique.

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
  `settings.ts` point at an `adapterId` (`ollama-native` for the native Ollama
  API); `requestCompletion` resolves it and forwards streaming/cancel options.
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

## Plugin platform

`src/lib/plugins/` and `src/context/plugins.tsx` add a second, manifest-driven
lifecycle on top of the registries above. **Plugins** in the drawer opens the
Plugin Manager, where bundled manifests can be installed, enabled, inspected,
updated and disabled. Permissions are default-deny and requested through the
approval dialog; trust levels do not grant permissions and gate built-in entry points.

What is implemented today:

- Declarative version-1 manifests with no downloaded JavaScript. See
  `plugins/example-plugin/manifest.json`.
- A bundled catalog with the Cordis core service metadata, built-in diagnostics,
  ten reviewed ORBIT native plugins and the example plugin. Catalog registration
  is not installation.
- Explicit lifecycle transitions, dependency checks, hook timeouts, update
  backups and rollback, backed by the v12 SQLite schema.
- Namespaced plugin tools (`plugin__<slug>__<name>`), per-plugin JSON storage and
  settings, typed in-process events, and default-deny permission grants.
- MCP servers mirrored as synthetic `mcp.server.<slug>` plugins with a tool gate
  installed in the constructor; tools are denied until records are synced.
  Revoking `mcp.connect` or `ai.invoke` is sticky across re-sync.
- Read-only agent tools: `cordis_plugin_list`,
  `cordis_plugin_inspect`, and `cordis_plugin_permission_audit`.
- Smart on-demand plugin requests: `orbit_plugin_discover` reads only the bundled
  trusted catalog and configured MCP servers; `orbit_plugin_request` shows the
  exact plugin, version, publisher, dependencies, permissions and steps in the
  native approval dialog before the existing registry installs or updates it.
  Denials, timeouts and failures change nothing.
- Demand history and auto-installed state appear in the Plugin Manager.
  Auto-installed plugins can be disabled when idle but are never auto-uninstalled;
  manually installed plugins are never disabled by this path.
- A reviewed built-in tool can run its data-only body in the Android isolated
  sandbox through the same `PluginRegistry` and approval queue; no second runtime
  or downloaded code. MCP tools keep their host-side network bridge.
- Ten native plugins (`orbit.builtin.*`) provide Agent, Memory, Files, Browser,
  Code, Tasks, Projects, Buddy, MCP and Sandbox tools through the same runtime.
  They reuse existing app services and stores; sensitive actions require fresh
  approval. Browser has no page fetcher or arbitrary-URL WebView, Code has no
  execution tool, MCP adds no second transport, and Sandbox is Android-only and
  data-only.
- Legacy hook code is disabled: stored hook rows are never compiled or
  evaluated, and failed executions are recorded and ignored by the agent.

Limitations: no remote marketplace, no downloaded executable plugin code, no
notifications/credentials SDK adapter, no SDK file API, no `sdk.mcp`, and no
global widget or settings-section renderer. On-demand discovery never fetches
unknown manifests from the network. Plugin-specific Vitest files live
under `src/lib/plugins/__tests__/`; no results are asserted here. Details are in
[`docs/PLUGIN_ARCHITECTURE.md`](docs/PLUGIN_ARCHITECTURE.md),
[`docs/PLUGIN_MANIFEST.md`](docs/PLUGIN_MANIFEST.md),
[`docs/PLUGIN_SECURITY.md`](docs/PLUGIN_SECURITY.md),
[`docs/PLUGIN_SDK.md`](docs/PLUGIN_SDK.md),
[`docs/PLUGIN_DEVELOPER_GUIDE.md`](docs/PLUGIN_DEVELOPER_GUIDE.md), and
[`docs/PLUGIN_MIGRATION.md`](docs/PLUGIN_MIGRATION.md).

To verify plugin-related changes locally:

```sh
npx tsc --noEmit
npx expo lint
npm test
npx expo export --platform android --no-bytecode
```

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

Android builds run automatically for pull requests and `main` pushes, but they
only upload CI artifacts. Pushing a `v*` tag builds and publishes a public
GitHub Release automatically.

To publish a release:

1. Bump **both** `app.json` and `package.json` to the same version in a PR and
   merge it (for example `1.10.6`).
2. Tag the merged `main` commit and push the tag:

   ```bash
   git switch main && git pull --ff-only
   git tag -a v1.10.6 -m "Orbit v1.10.6"
   git push origin v1.10.6
   ```

3. The **Android** workflow builds the APK/AAB, verifies checksums and the
   signing status, then creates the release. If the `release` environment has
   required reviewers, approve the run when prompted.

You can also publish from **Actions → Android → Run workflow** on `main`:
check `publish_release` and leave `release_tag` empty (it defaults to
`v<app.json version>`).

Normal `main` pushes and pull requests never create, edit, or overwrite a
release. They only upload CI artifacts. The public release contains
`ORBIT-release.apk`, `ORBIT-release.aab`, `SHA256SUMS.txt`, and
`build-info.txt`; `ORBIT-debug.apk` is kept as a CI artifact only and is never
attached to a public release. Download the release APK on your phone and
install it (allow "Install unknown apps" for your browser/file manager).

Releases page:

```text
https://github.com/What-if-Ajeeb/Orbit/releases
```

> Without `ORBIT_*` signing secrets, releases are **debug-signed** and the
> release notes say so. That is fine for sideloading/testing. After adding a
> release keystore, set the repository variable
> `ORBIT_REQUIRE_RELEASE_SIGNING=true` to block unsigned releases.
> For a Play Store build, use EAS Build with a production keystore.

## Contributing / Git workflow

`main` is protected: no direct pushes, force-pushes, or unverified merges. Work
on a short-lived topic branch, open a PR, and squash-merge after CI is green.

```bash
bash scripts/git/setup.sh          # once per clone: installs hooks + defaults
git switch main && git pull --ff-only
git switch -c feat/my-change
# edit + verify
git add -p
git commit -m "feat(scope): imperative summary"
git push -u origin HEAD
```

Commit messages and PR titles follow Conventional Commits. Required checks are
`Validate`, `Build Android`, and `PR title`. See
**[`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md)** for the full branch, commit,
review, release, and recovery policy.

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
      _layout.tsx         # app sidebar + bottom navigation + notification taps
      index.tsx           # Today dashboard
      chat.tsx            # agent conversation + chat history panel
      tasks.tsx           # task list + quick add
      settings.tsx        # AI, MCP, reminders, permissions, account, data
      settings/navigation.tsx # three-slot bottom navigation customization
      agent-action.tsx    # durable action card detail + approval/execution
      harness.tsx         # plugin dashboard (drawer entry)
      policy.tsx          # tool approval policy rules
      permissions.tsx     # agent consent control room + companion pairing
  components/             # Brand, Button, TaskItem, ChatBubble, AppSidebar, ...
    actions/              # reusable durable AgentActionCard
    BottomNavigation.tsx  # floating three-slot pill and Settings preview
    NavigationFooter.tsx  # single shared footer host for the app layout
    TabletShell.tsx       # landscape shell: sidebar + workspace + context panel
    TabletSidebar.tsx     # persistent icon rail/full sidebar
    TabletContextPanel.tsx # resizable task/context pane
    OrientationController.tsx # phones portrait, tablets free to rotate
    permissions/          # global approval dialog, host, pairing modal
  hooks/
    useResponsiveLayout.ts # window breakpoints with keyboard-stable dimensions
  context/
    auth.tsx              # session state + sign in/up/out
    sidebar.tsx           # app-wide drawer state
    bottom-navigation.tsx # saved/draft slot customization state
    navigation-footer.tsx # route-aware footer visibility + layout reservation
    pinned-plugins.tsx    # persisted user-pinned plugin IDs
    tablet-layout.tsx     # sidebar/panel state across rotations
  lib/
    agent-actions/        # typed integrations, durable store, approval/execution service
    bottom-navigation.ts  # destinations, route visibility + exactly-three resolution
    bottom-navigation-storage.ts # versioned local slot persistence
    responsive.ts         # phone/tablet breakpoint classification
    pinned-plugins.ts     # versioned pin-ID persistence
    tablet-layout-storage.ts # sidebar/panel preference persistence
    ai/
      agent.ts            # tool-calling loop (max 6 rounds)
      provider-registry.ts # provider plugin seam
      providers.ts        # OpenAI-compatible, Gemini and native Ollama adapters
      ollama.ts           # /api/tags discovery, /api/chat + NDJSON streaming
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
    db.ts                 # SQLite schema + migrations (v12)
    dates.ts              # formatting + natural-language date parsing
    hooks.ts              # legacy hook rows retained; code execution disabled
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
- `skills`, `hooks`, `subagents`, `subagent_tasks` — legacy runtime extension stores (v6); hook rows are retained for data compatibility but their code is never executed
- `permission_requests`, `permission_grants`, `permission_audit`, `permission_agents`, `paired_devices`, `permission_state` — agent consent, grants, audit, companion sessions, and emergency-stop state (v7)
- `plugin_records`, `plugin_versions`, `plugin_dependencies`, `plugin_permissions`, `plugin_permission_audit`, `plugin_install_history`, `plugin_settings`, `plugin_kv`, `plugin_backups`, `plugin_meta` — declarative plugin lifecycle, permissions, settings, KV, history and backups (v12)

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
