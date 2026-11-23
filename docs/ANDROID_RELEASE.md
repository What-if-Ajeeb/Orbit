# Android CI / Release

Orbit builds Android in GitHub Actions. Local APK/AAB builds are not supported in
the dev container (no JDK/Android SDK); use CI or a machine with JDK 17 +
Android SDK.

## Workflows

| Workflow | Triggers | What it does |
| --- | --- | --- |
| `ci.yml` | PRs, `main` pushes, manual | `npm ci`, Expo Doctor (non-blocking), TypeScript, ESLint, Vitest, Jest |
| `android.yml` | PRs, `main` pushes, `v*` tag pushes, manual | Debug APK, release APK, AAB, artifact validation, checksums, upload |
| `pr-title.yml` | PR opened/edited/reopened/synced | Validates the Conventional Commit PR title |
| `protect-main.sh` (script) | manual, repo admin | Applies branch protection + squash-only merge settings |

`android.yml` never publishes on push, PR, or tag. A public GitHub Release is
created **only** by a confirmed manual run from `main`.

## Versioning

`app.json` → `expo.version` is the single source of truth.

- `package.json` `version` must exactly equal `expo.version`.
- Both must match `MAJOR.MINOR.PATCH`, with `MINOR`/`PATCH` below 1000.
- Android `versionCode` is derived in `app.config.js` as
  `MAJOR * 1_000_000 + MINOR * 1_000 + PATCH`.
- A release tag is `v<version>`, e.g. `v1.10.6`. It must match the version in
  the commit being built; the workflow rejects anything else.
- Never hand-create a `v*` tag and never reuse a published tag. Bump the version
  and publish a new release.

## One-time GitHub setup

1. **Environment `release`**
   - Settings → Environments → New environment → `release`.
   - Add required reviewers so publishing needs a human approval.
2. **Signing secrets** (environment `release` is recommended, repo-level also works):
   - `ORBIT_KEYSTORE_BASE64` — base64 of the release keystore
   - `ORBIT_RELEASE_STORE_PASSWORD`
   - `ORBIT_RELEASE_KEY_ALIAS`
   - `ORBIT_RELEASE_KEY_PASSWORD`
3. **Branch protection**
   ```bash
   gh auth login
   bash scripts/git/protect-main.sh
   ```

Without signing secrets, artifact-only builds fall back to the debug keystore.
That is fine for sideload testing, but **publishing is blocked** until signing is
configured.

## Publishing a release

1. Open a PR that bumps **both** `app.json` and `package.json` to the same
   version, e.g. `chore(release): 1.11.0`.
2. Merge the PR after CI is green.
3. Open **Actions → Android → Run workflow**:
   - branch: `main`
   - `publish_release`: `true`
   - `confirm_public_release`: `true`
   - `release_tag`: `v1.11.0`
4. Approve the `release` environment when prompted.
5. The workflow:
   - validates the tag against `app.json` before building
   - builds debug + release artifacts and records `signed=true`
   - verifies ZIP integrity, `SHA256SUMS.txt`, the signed flag, and the app version
   - creates a **draft** release, verifies every asset is attached, then publishes
   - deletes the draft if any verification step fails

Release assets:

- `ORBIT-release.apk`
- `ORBIT-release.aab`
- `SHA256SUMS.txt`
- `build-info.txt` (commit, ref, event, run ID, version, package, signing status, UTC timestamp)

`ORBIT-debug.apk` is uploaded as a CI artifact only and is never attached to a
public release. CI artifacts are retained for 14 days.

## Artifact-only runs

Push to `main`, open a PR, push a `v*` tag, or run **Actions → Android** with
`publish_release=false` to build and upload artifacts without publishing. This is
the safe way to test the Android pipeline.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `app.json (...) and package.json (...) versions differ` | Bump both to the same version in the same PR |
| `release_tag must equal v...` | Use `v` + the exact `app.json` version |
| `publish_release=true requires release-signing secrets` | Add the `ORBIT_*` secrets (or run artifact-only) |
| `Refusing to publish an unsigned build` | The build did not report `signed=true`; fix signing, rebuild |
| `Release vX.Y.Z already exists` | Never reuse a tag; bump the patch version |
| `Draft release ... is missing asset` | Artifact upload/download failed; re-run the workflow |
| `SHA256SUMS.txt` mismatch | Artifacts were corrupted or mixed between runs; rebuild |

## Security notes

- The release job is the only job with `contents: write`; all other jobs are read-only.
- Workflow actions are pinned to commit SHAs; Dependabot updates the pins.
- The keystore is decoded only for the duration of the build and removed with
  `if: always()`.
- Public releases require a signed build and explicit human confirmation.
