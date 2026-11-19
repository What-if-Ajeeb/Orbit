# Orbit

A local-first React Native app for Android. Accounts, sessions, and app data live
on the phone — no server, no cloud, no network required.

Built with **Expo SDK 58**, **Expo Router**, **expo-sqlite**, and **expo-secure-store**.

## What's included

- Email + password sign up / sign in
- Passwords hashed with PBKDF2-SHA256 (120,000 iterations) and a random salt
- 30-day sessions; only a SHA-256 hash of the token is stored in SQLite
- Session token kept in the Android Keystore-backed `expo-secure-store`
- Protected routes via Expo Router (`Stack.Protected`)
- Dark, mobile-first UI with a home dashboard

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
  app/                 # every file is a route (Expo Router)
    _layout.tsx        # SQLite + session providers, protected routes
    sign-in.tsx
    sign-up.tsx
    (app)/
      _layout.tsx
      index.tsx        # home screen after login
  components/          # Brand, Button, TextField, AuthShell, FormError
  context/auth.tsx     # session state + sign in/up/out
  lib/
    auth.ts            # hashing, sessions, account queries
    db.ts              # SQLite schema + migrations
    session-storage.ts # SecureStore (with a web localStorage fallback)
    validation.ts
  theme.ts
```

New screens added under `src/app/` become routes automatically.

## Local backend notes

- Database file: `orbit.db` in the app's private SQLite directory.
- Passwords are never stored in plain text.
- Signing out deletes the session row and the stored token.
- Clear app storage (or reinstall) to reset all local accounts.
- Real email verification / password reset needs an email provider and network
  access; add that later if the app needs account recovery.

## Ideas for next features

- Notes or tasks stored in SQLite (add a table in `src/lib/db.ts` and bump
  `DATABASE_VERSION`)
- Biometric unlock with `expo-local-authentication`
- Export / import a backup with `expo-sharing` and `expo-document-picker`
- Cloud sync later, keeping the local database as the source of truth
