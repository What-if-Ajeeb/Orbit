# Git Workflow

Orbit uses a **protected `main` + short-lived topic branches + squash merges**.
`main` is always buildable and releasable. Nothing lands on `main` without a
pull request and green CI.

> Run `bash scripts/git/setup.sh` once per clone. It installs the repo hooks
> (`core.hooksPath=.githooks`) and sets rebase/prune defaults.

---

## 1. Rules at a glance

| Rule | Why |
| --- | --- |
| Never commit or push directly to `main` | Keeps history linear and reviewable; enforced by hooks + branch protection |
| One topic per branch, short-lived | Small PRs are faster to review and safer to revert |
| Conventional Commit messages | Parsable history, changelogs, and release notes |
| Squash merge only | One commit per PR on `main`; no merge bubbles |
| CI must be green before merge | Required checks: `Validate`, `Build Android`, `PR title` |
| Force-push only your own branch, always with `--force-with-lease` | Never rewrite shared history |
| Releases are explicit and version-checked | Only a `v*` tag push or a manual publish run can create a release |

---

## 2. One-time setup

### Local

```bash
git clone git@github.com:What-if-Ajeeb/Orbit.git
cd Orbit
bash scripts/git/setup.sh
```

Set a GitHub-linked identity if the script warns about it:

```bash
git config --local user.name  "Your Name"
git config --local user.email "you@users.noreply.github.com"
```

### Remote (repo admin, once)

```bash
gh auth login
bash scripts/git/protect-main.sh --dry-run   # review
bash scripts/git/protect-main.sh             # apply
```

This configures:

- required PR + linear history, no force-push/delete on `main`
- required checks: `Validate`, `Build Android`, `PR title`
- squash-only merges + automatic head-branch deletion
- conversation resolution before merge
- admin enforcement (rules apply to everyone)

Also create the `release` environment with required reviewers and add the
`ORBIT_*` signing secrets — see [ANDROID_RELEASE.md](ANDROID_RELEASE.md). If the
environment uses deployment branch rules, allow `main` and `v*` tags.

Without `gh`, configure the same settings in **Settings → Branches → Add branch
protection rule** and **Settings → General → Pull Requests**.

---

## 3. Daily flow

```bash
# 1. Start from a fresh main
git switch main
git pull --ff-only

# 2. Create a topic branch
git switch -c feat/offline-chat-cache

# 3. Work in small commits
git add -p
git commit -m "feat(chat): cache messages for offline use"

# 4. Rebase if main moved (repeat as needed)
git fetch origin
git rebase origin/main

# 5. Run the local verification loop
npm run typecheck
npm run lint
npm test
npm run test:rn
npx expo export --platform android --no-bytecode

# 6. Push and open a PR
git push -u origin HEAD
```

Open the PR using the link GitHub prints, or:

```bash
gh pr create --fill --base main
```

Merge only when CI is green:

```bash
gh pr merge --squash --delete-branch
```

Locally, delete the merged branch:

```bash
git switch main && git pull --ff-only
git branch -d feat/offline-chat-cache
```

### Why squash?

- `main` stays linear and bisectable.
- The PR title becomes the commit message — that is why CI validates it.
- Reverting a feature is a single `git revert <sha>`.

---

## 4. Branch naming

| Prefix | Use |
| --- | --- |
| `feat/<topic>` | New user-facing capability |
| `fix/<topic>` | Bug fix |
| `chore/<topic>` | Tooling, deps, cleanup |
| `ci/<topic>` | GitHub Actions / release pipeline |
| `docs/<topic>` | Documentation only |
| `refactor/<topic>` | Internal restructuring |
| `hotfix/<topic>` | Urgent production fix branched from `main` |

Use lowercase, hyphenated, 2–5 words: `fix/settings-duplicate-listeners`.
Do not use spaces, dates, or personal names.

---

## 5. Commit messages (Conventional Commits)

```text
<type>(optional-scope)!: <imperative summary>
```

Examples:

```text
feat(chat): add retry for failed tool calls
fix(settings): stop duplicate notification listeners
chore(deps): bump react-native-svg to 15.16.1
ci(android): require a signed build before publishing
docs: explain the release workflow
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`,
`test`, `build`, `ci`, `revert`.

Rules enforced by `.githooks/commit-msg`:

- header ≤ 100 characters
- no trailing period
- `!` marks a breaking change
- scope, when present, is lowercase: `fix(settings)`, not `fix(Settings)`

Merge/revert/fixup commits from Git and GitHub are exempt.

---

## 6. Pull requests

- Title must be a Conventional Commit (becomes the squash commit).
- Fill in the PR template: summary, type, verification, release impact.
- Keep PRs focused; split unrelated changes.
- Required CI checks:
  - **Validate** — `npm ci`, Expo Doctor, TypeScript, ESLint, Vitest, Jest
  - **Build Android** — debug + release APK/AAB build on every PR
  - **PR title** — Conventional Commit check
- Resolve all review conversations before merging.
- Use **Squash and merge** only.

---

## 7. Keeping history clean

```bash
# Update your branch onto latest main
git fetch origin
git rebase origin/main

# After a rebase, update your remote branch safely
git push --force-with-lease
```

- Never `git push --force` (without lease).
- Never force-push `main`.
- Avoid rebasing a branch someone else is actively working on.
- If a merge conflict appears during rebase, resolve it, `git add` the files,
  then `git rebase --continue` (or `--abort` to back out).

Useful aliases installed by `setup.sh`:

```bash
git lg       # graph log
git sync     # fetch + rebase onto origin/main
git last     # last commit with stats
git undo     # soft-reset the last commit (keeps changes staged)
```

---

## 8. Releases and versioning

`app.json` → `expo.version` is the single source of truth. `package.json`
`version` must match exactly. Android `versionCode` is derived as
`MAJOR * 1_000_000 + MINOR * 1_000 + PATCH`.

### Release checklist

1. Open a PR that bumps **both** versions to the same value:

   ```bash
   # edit app.json and package.json, then:
   git commit -am "chore(release): 1.11.0"
   ```

2. Merge the PR after CI is green.
3. Tag the merged `main` commit and push the tag:

   ```bash
   git switch main && git pull --ff-only
   git tag -a v1.11.0 -m "Orbit v1.11.0"
   git push origin v1.11.0
   ```

4. Approve the `release` environment when prompted (if it has reviewers).
5. The workflow checks the tag against `app.json`, builds, verifies the signing
   status and `SHA256SUMS.txt`, creates a **draft** release, verifies its
   assets, then publishes it.

To retry without creating a new tag, use **Actions → Android → Run workflow** on
`main`, check `publish_release`, and leave `release_tag` empty to use
`v<app.json version>`.

Rules:

- PRs and `main` pushes only upload CI artifacts.
- Tag the merged `main` commit. Never move or reuse a published tag; bump the
  version instead.
- Signing secrets are optional; without them the release is debug-signed and
  marked as such. Set `ORBIT_REQUIRE_RELEASE_SIGNING=true` to require signed builds.

See [ANDROID_RELEASE.md](ANDROID_RELEASE.md) for signing setup and troubleshooting.

---

## 9. Dependabot

- GitHub Actions and npm updates run weekly, grouped by minor/patch.
- Major upgrades (Expo, React, React Native) are intentionally not auto-opened;
  plan them as a dedicated branch + PR and run the full Android build.
- Never merge a Dependabot PR with red CI.
- After merging one, rebase/close the remaining open PRs so they stay current.

---

## 10. Hooks and bypasses

Hooks live in `.githooks/` and are enabled by `scripts/git/setup.sh`.

| Hook | What it blocks |
| --- | --- |
| `pre-commit` | commits on `main`, secrets/keystores, files > 5 MB, generated paths, invalid JSON/workflow YAML, non-executable `.sh`, conflict markers |
| `commit-msg` | non-Conventional-Commit messages |
| `pre-push` | direct pushes/force-pushes to `main`, `WIP`/`fixup!` commits |

They are **fast local guardrails**, not a replacement for CI. Bypasses are for
recovery only and should be followed by a clean PR:

```bash
SKIP_GIT_HOOKS=1 git commit ...   # skip pre-commit + commit-msg
SKIP_GIT_HOOKS=1 git push ...     # skip pre-push
ALLOW_MAIN_COMMIT=1 ...           # allow a local commit on main
ALLOW_MAIN_PUSH=1 ...             # allow a direct main push (bootstrap only)
```

Hooks are local: a contributor who skips setup still hits branch protection and
required CI checks on the remote.

---

## 11. Cleanup and recovery

```bash
# List local branches merged into main; add --apply to delete
bash scripts/git/cleanup-branches.sh
bash scripts/git/cleanup-branches.sh --apply

# Prune deleted remote branches
git fetch --prune

# Undo a local commit but keep the changes
git reset --soft HEAD~1

# Discard local changes and match origin/main exactly
git fetch origin
git reset --hard origin/main

# Recover a lost commit/branch (reflog is your safety net)
git reflog
git switch -c rescue/<name> <sha>
```

**To undo something already on `main`, use `git revert` — never rewrite `main`.**

```bash
git switch main && git pull --ff-only
git revert <sha>          # creates a new commit
git push                  # blocked by hook; open a revert PR instead
```

For a broken release, revert the offending commit via a PR, bump the patch
version, and publish a new release.

---

## 12. Do / Don't

| Do | Don't |
| --- | --- |
| Branch from up-to-date `main` | Commit directly to `main` |
| One logical change per PR | Mix refactor + feature + release bump |
| `git rebase origin/main` + `--force-with-lease` | `git push --force` |
| `git revert` on `main` | `git reset` + force-push `main` |
| Delete merged branches | Leave stale branches for months |
| Tag merged `main` commits for releases | Move, delete, or reuse published tags |
| Run the verification loop before pushing | Rely on CI to catch obvious failures |

---

## 13. Current branch/tag policy

- `main` — protected, always releasable.
- `feat/*`, `fix/*`, `chore/*`, `ci/*`, `docs/*`, `refactor/*`, `hotfix/*` —
  short-lived, auto-deleted after merge.
- `dependabot/*` — managed by Dependabot; do not push to them manually.
- `archive/*` tags — abandoned work preserved for recovery; never build from them.
- `v*` tags — release markers on merged `main` commits; pushing one publishes a release.
