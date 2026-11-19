# Orbit

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
- AI settings screen with provider presets, connection test, and secure key storage
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
      settings.tsx        # AI, reminders, account, data
  components/             # Brand, Button, TaskItem, ChatBubble, AppSidebar, ...
  context/
    auth.tsx              # session state + sign in/up/out
    sidebar.tsx           # app-wide drawer state
  lib/
    ai/
      agent.ts            # tool-calling loop (max 6 rounds)
      providers.ts        # OpenAI-compatible + Gemini clients
      tools.ts            # task tools exposed to the model
      prompt.ts           # system prompt with local date/time
      local-agent.ts      # offline fallback parser
      settings.ts         # provider presets + SecureStore config
    auth.ts               # hashing, sessions, account queries
    chat.ts             # persisted conversations + messages
    db.ts               # SQLite schema + migrations (v3)
    dates.ts              # formatting + natural-language date parsing
    notifications.ts      # local notification scheduling
    tasks.ts              # task CRUD + reminder sync
    validation.ts
  theme.ts
```

New screens added under `src/app/` become routes automatically.

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
