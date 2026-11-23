# Android CI / Release

Orbit builds Android in GitHub Actions. Local APK/AAB builds are not supported in
the dev container (no JDK/Android SDK); use CI or a machine with JDK 17 +
Android SDK.

## Workflows

| Workflow | Triggers | What it does |
| --- | --- | --- |
| `ci.yml` | PRs, `main` pushes, manual | `npm ci`, Expo Doctor (non-blocking), TypeScript, ESLint, Vitest, Jest |
| `android.yml` | PRs, `main` pushes, `v*` tag pushes, manual | Debug APK, release APK, AAB, artifact validation, checksums, upload; publishes a GitHub Release on `v*` tags or manual publish runs |
| `pr-title.yml` | PR opened/edited/reopened/synced | Validates the Conventional Commit PR title |
| `protect-main.sh` (script) | manual, repo admin | Applies branch protection + squash-only merge settings |

`android.yml` publishes on a `v*` tag push, or on a manual run from `main` with
`publish_release` checked. PRs and `main` pushes only upload artifacts.

## Versioning

`app.json` → `expo.version` is the single source of truth.

- `package.json` `version` must exactly equal `expo.version`.
- Both must match `MAJOR.MINOR.PATCH`, with `MINOR`/`PATCH` below 1000.
- Android `versionCode` is derived in `app.config.js` as
  `MAJOR * 1_000_000 + MINOR * 1_000 + PATCH`.
- A release tag is `v<version>`, e.g. `v1.10.6`. It must match the version in
  the commit being built; the workflow rejects anything else.
- Create the tag from the merged `main` commit after the version-bump PR is
  green. Never move, delete, or reuse a published tag — bump the version and
  publish a new release instead.

## One-time GitHub setup

1. **Environment `release`**
   - Settings → Environments → New environment → `release`.
   - Add required reviewers so publishing needs a human approval.
   - Leave deployment branches/tags unrestricted (or allow both `main` and
     `v*` tags), otherwise tag-triggered releases are blocked.
2. **Signing secrets** — add these as **repository-level** secrets so the build
   job can see them (environment-scoped secrets are not available to the build
   job):
   - `ORBIT_KEYSTORE_BASE64` — base64 of the release keystore
   - `ORBIT_RELEASE_STORE_PASSWORD`
   - `ORBIT_RELEASE_KEY_ALIAS`
   - `ORBIT_RELEASE_KEY_PASSWORD`
3. **Optional strict signing** — add repository variable
   `ORBIT_REQUIRE_RELEASE_SIGNING=true` to block publishing unsigned builds.
4. **Branch protection**
   ```bash
   gh auth login
   bash scripts/git/protect-main.sh
   ```

Without signing secrets, the build uses the debug keystore and releases are
marked **debug-signed**. That is fine for sideload testing; set
`ORBIT_REQUIRE_RELEASE_SIGNING=true` once a real keystore is configured.

## Publishing a release

1. Open a PR that bumps **both** `app.json` and `package.json` to the same
   version, e.g. `chore(release): 1.10.6`.
2. Merge the PR after CI is green.
3. Tag the merged `main` commit and push the tag:

   ```bash
   git switch main && git pull --ff-only
   git tag -a v1.10.6 -m "Orbit v1.10.6"
   git push origin v1.10.6
   ```

4. Approve the `release` environment when prompted (if it has reviewers).
5. The workflow:
   - checks that the tag equals `v<app.json version>` before building
   - builds debug + release artifacts and records `signed=true|false`
   - verifies ZIP integrity, `SHA256SUMS.txt`, the recorded signing flag, and the app version
   - creates a **draft** release, verifies every asset is attached, then publishes
   - deletes the draft if any verification step fails

If you need to retry from an existing `main` commit, use **Actions → Android →
Run workflow** on `main`, check `publish_release`, and leave `release_tag` empty
to use `v<app.json version>` (or set it explicitly). A tag can only produce one
release; bump the version to publish again.

Release assets:

- `ORBIT-release.apk`
- `ORBIT-release.aab`
- `SHA256SUMS.txt`
- `build-info.txt` (commit, ref, event, run ID, version, package, signing status, UTC timestamp)

`ORBIT-debug.apk` is uploaded as a CI artifact only and is never attached to a
public release. CI artifacts are retained for 14 days.

## Artifact-only runs

Push to `main`, open a PR, or run **Actions → Android** with
`publish_release=false` to build and upload artifacts without publishing. This is
the safe way to test the Android pipeline. Tag pushes are not artifact-only.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Android run succeeds but no release appears | The run was artifact-only (PR, `main` push, or `publish_release` not checked). Push a `v*` tag or re-run with `publish_release` checked. |
| Pushed a tag but no run started | Tags only trigger on `v*`; confirm with `git push origin v1.10.6`. |
| Release job is waiting | Approve the `release` environment deployment in the Actions run. |
| `app.json (...) and package.json (...) versions differ` | Bump both to the same version in the same PR |
| `Release tag must equal v...` | Tag/input must be `v` + the exact `app.json` version |
| `ORBIT_REQUIRE_RELEASE_SIGNING=true but ... secrets are missing` | Add the repository-level `ORBIT_*` secrets, or unset the strict variable |
| `Release vX.Y.Z already exists` | Never reuse a tag; bump the patch version |
| `Draft release ... is missing asset` | Artifact upload/download failed; re-run the workflow |
| `SHA256SUMS.txt` mismatch | Artifacts were corrupted or mixed between runs; rebuild |

## Security notes

- The release job is the only job with `contents: write`; all other jobs are read-only.
- Workflow actions are pinned to commit SHAs; Dependabot updates the pins.
- The keystore is decoded only for the duration of the build and removed with
  `if: always()`.
- Publishing is explicit: a `v*` tag push or a manual `publish_release` run,
  always with an exact `v<app.json version>` check.
- Releases are debug-signed with a visible warning unless signing secrets are
  configured; set `ORBIT_REQUIRE_RELEASE_SIGNING=true` to enforce signed builds.
