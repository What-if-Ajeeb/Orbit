# Multi-File Edits, Bugs & Refactors

This document describes how changes are made across the Orbit codebase — building features, fixing errors, and running multi-step refactors or migrations — while executing tests and iterating on failures.

## 1. Philosophy

Every change, no matter how small, must pass through the same verification loop:

1. **Edit** — Make targeted changes across one or more files.
2. **Typecheck** — Run `npx tsc --noEmit` to catch type errors.
3. **Lint** — Run `npx expo lint` to catch style/issues.
4. **Export** — Run `npx expo export --platform android --no-bytecode` to verify the Android bundle builds.
5. **Commit** — Commit only when all checks pass.
6. **Push** — Push to `main` only after the commit is clean.

If any step fails, fix the error and restart from step 2. Do not skip checks to save time.

## 2. Multi-File Edits

When a feature touches more than one file (e.g., adding a new screen), follow this order:

1. **Lib layer first** — Add or modify libraries under `src/lib/` (types, stores, registries, clients).
2. **Components second** — Add or modify shared components under `src/components/`.
3. **Screens last** — Add or modify screens under `src/app/(app)/`.
4. **Routes & navigation** — Wire new screens into `src/app/(app)/_layout.tsx` tabs and `src/components/AppSidebar.tsx` drawer entries.
5. **Docs** — Update `README.md` and `docs/HARNESS.md` if user-facing behavior changes.

### Example flow: Adding a new settings screen

```
src/lib/settings.ts          → New settings storage functions
src/components/SettingCard.tsx → Reusable UI component
src/app/(app)/settings.tsx   → Wire into existing settings screen
src/app/(app)/_layout.tsx    → Add tab route
src/components/AppSidebar.tsx → Add drawer item
README.md                    → Document new feature
```

## 3. Bug Fixes

When a bug is reported or found during checks:

1. **Reproduce** — Confirm the error exists (typecheck error, lint warning, runtime crash, or wrong behavior).
2. **Isolate** — Find the smallest set of files responsible.
3. **Fix** — Edit the minimal code needed.
4. **Verify** — Run `tsc`, `lint`, and `export` again.
5. **Regress** — Check that related screens still work.

Never fix a bug by suppressing a type error with `any` or `// @ts-ignore` unless absolutely necessary, and document why if you do.

## 4. Refactors & Migrations

### Database migrations (SQLite)

Orbit uses `expo-sqlite` with a versioned schema in `src/lib/db.ts`.

When changing the database:

1. Increment `DATABASE_VERSION` in `migrateDbIfNeeded`.
2. Add a new `if (currentDbVersion === N)` block.
3. Write `CREATE TABLE`, `ALTER TABLE`, or index SQL.
4. Test on a fresh install and an upgrade path (simulate old version).
5. Update `docs/HARNESS.md` if the schema changes are user-facing.

Example (from v4 → v5):

```ts
if (currentDbVersion === 4) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS plugins (...);
    CREATE INDEX IF NOT EXISTS idx_plugins_type_enabled ON plugins (type, enabled);
  `);
  currentDbVersion = 5;
}
```

### Code refactors

When renaming modules or moving code:

1. Use `git mv` for file renames so history is preserved.
2. Update all import paths across the app (use `grep -r` to find references).
3. Run `tsc --noEmit` to catch broken imports.
4. Run `expo lint` and `expo export`.

## 5. Testing & Verification Commands

Always run these before committing:

```bash
# TypeScript typecheck
npx tsc --noEmit

# ESLint
npx expo lint

# Android bundle export (verifies Metro bundling works)
npx expo export --platform android --no-bytecode --output-dir /tmp/opencode/orbit-export
```

Note: The default Hermes bytecode export may fail in this container (`hermesc` SIGILL). Always use `--no-bytecode` for verification here.

### Expected outcomes

| Command | Success signal |
|---|---|
| `tsc --noEmit` | No output, exit code 0 |
| `expo lint` | No output (or only pre-existing warnings), exit code 0 |
| `expo export` | `Exported: /tmp/opencode/orbit-export` and a `.js` bundle listed |

## 6. Iterating on Failures

If a check fails:

1. Read the error message fully.
2. If it's a TypeScript error, fix the type mismatch — do not cast away types unless unavoidable.
3. If it's an ESLint warning, either fix the code or add an exception comment with a reason.
4. If it's an export failure, check the Metro bundler output for the offending module.
5. Re-run the failing command. Only proceed to the next check when the current one passes.

Do not chain multiple unverified changes together. Make one change, verify, then move to the next.

## 6. Git Workflow

```bash
git add -A
git commit -m "Concise summary of changes"
git push origin main
```

- Commit messages should be imperative mood ("Add MCP card", not "Added MCP card").
- If the change includes new features, consider bumping the version in `package.json` and `app.json`, then tagging (`git tag v1.6.0`).
- Never push to `main` with uncommitted changes or failing checks.

## 7. Files Touched by Type

| Area | Typical files |
|---|---|
| AI provider/tool/chat seams | `src/lib/ai/*.ts`, `src/lib/harness/*`, `src/lib/mcp/*` |
| Database | `src/lib/db.ts`, `src/lib/plugin-store.ts`, `src/lib/events.ts`, `src/lib/telemetry.ts` |
| Screens | `src/app/(app)/*.tsx` |
| Components | `src/components/*.tsx` |
| Navigation | `src/app/(app)/_layout.tsx`, `src/components/AppSidebar.tsx` |
| Theme | `src/theme.ts`, `src/context/theme.tsx` |
| Docs | `README.md`, `docs/HARNESS.md`, `docs/OPERATIONS.md` |

## 8. Emergencies

If a change breaks the build and you cannot fix it quickly:

1. `git stash` the broken changes.
2. Verify `main` is clean and builds.
3. Re-apply changes one file at a time, verifying after each.
4. Do not push broken code to `main`.

---

This document is a living reference. Update it when the tooling or workflow changes.
