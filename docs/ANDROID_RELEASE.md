# Android Release / CI

## Environment diagnosis (this container)

- OS: Linux container; `java`, `javac`, `adb`, Android SDK, Gradle not installed. `JAVA_HOME` unset.
- Expo SDK: `~58.0.26`, React Native: `0.88.1`, `react-native-svg`: `15.16.0` (from `package.json`).
- Android project is generated (CNG) via `npx expo prebuild --platform android --no-install` in CI.
- **Conclusion**: Local Android APK/AAB builds are **not supported in this environment**. Android builds must run in GitHub Actions (or a machine with JDK 17 + Android SDK).

## Workflows

- `.github/workflows/ci.yml` - JS validation: `npm ci`, `npx expo-doctor` (non-blocking), `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run test:rn` (Jest), `npx expo export --platform android --no-bytecode`, plus shell-script and workflow-YAML syntax checks. Runs on `pull_request`, manual `workflow_dispatch`, and as a reusable `workflow_call` (invoked by `android-ci.yml` for `main` pushes and `v*` tag pushes). It does **not** run on `push` directly, so `main` pushes are validated exactly once via `android-ci.yml`.
- `.github/workflows/android-ci.yml` - Android build pipeline. Runs `ci.yml` first, then plans/builds. Triggers: `push` to `main`, `push` to `v*` tags, and manual `workflow_dispatch`. `main` pushes and `v*` tag pushes build and upload CI-signed artifacts (no release secrets) and never publish a release. Manual dispatch can publish only when explicitly authorized.
- `.github/workflows/android-logcat3.yml` - manual-only diagnostic. Builds debug APK from source, launches on emulator, uploads logcat artifacts. No release publishing, no branch/tag writes, no hardcoded APK download.

## Release policy (unchanged)

Releases are **manual-only**.

- Nothing is published on push or tag push.
- Only `workflow_dispatch` on `main` with `publish_release=true`, `confirm_public_release=true`, and `release_tag=v<app.json version>` can publish.
- Existing GitHub Releases are never overwritten.
- The release tag must point at the workflow commit (or be created at that commit by the release).
- Workflow inputs are passed to scripts only through `env`.
- Permissions are least-privilege (`permissions: {}` at workflow top, granted per job).

## Versioning rule

`app.json` `expo.version` is the **single source of truth**.

- `package.json` version must equal `app.json` version.
- `release_tag` must equal `v${app.json.expo.version}`.
- Android `versionCode` is derived in `app.config.js` as `MAJOR*1000000 + MINOR*1000 + PATCH` (monotonic for MAJOR.MINOR.PATCH where MINOR/PATCH < 1000).
- `plugins/withReleaseSigning.js` is an Expo config plugin; it configures release signing from env and throws during prebuild when `ORBIT_REQUIRE_RELEASE_SIGNING=1` and required secrets are missing.

## Required GitHub configuration (one-time, repo owner)

1. **Create Environment `release`** with required reviewers. Only the `build-release` job uses it.
2. **Move signing secrets into Environment `release`** (not repo-wide):
   - `ORBIT_KEYSTORE_BASE64` - base64-encoded release keystore (renamed from `ORBIT_RELEASE_STORE_FILE`)
   - `ORBIT_RELEASE_STORE_PASSWORD`
   - `ORBIT_RELEASE_KEY_ALIAS`
   - `ORBIT_RELEASE_KEY_PASSWORD`
3. **Add repository variable** `ORBIT_RELEASE_CERT_SHA256` - SHA-256 of the release signing certificate. Release verification fails if missing, mismatched, or debug cert.
4. **Optional repository variable** `ORBIT_SMOKE_REQUIRED=true` - make emulator smoke test required after it is stable.
5. **Enable Dependabot** for GitHub Actions and npm (`.github/dependabot.yml` is included).

## Publishing a release

1. Bump `app.json` `expo.version` and `package.json` `version` to the same MAJOR.MINOR.PATCH.
2. Merge to `main`.
3. Open **Actions → Android Build → Run workflow** on `main`.
4. Set `publish_release=true`, `confirm_public_release=true`, `release_tag=vX.Y.Z`.
5. Approve the `release` environment when prompted.
6. Workflow builds signed artifacts, verifies certificate SHA-256, runs emulator smoke test, creates a **draft** release, verifies assets/checksums, then publishes it. If verification fails, the draft is deleted.

## Artifacts

Artifact retention:
- `ORBIT-android` (CI builds on `main` and `v*` tag pushes): retained **14 days**.
- `ORBIT-android` (authorized release builds): retained **90 days**.
- `ORBIT-symbols` and `ORBIT-smoke-logcat`: retained **14 days**.
- `ORBIT-logcat` (diagnostic workflow): retained **14 days**.

CI artifact upload (`ORBIT-android`):
- `ORBIT-debug.apk`
- `ORBIT-release.apk`
- `ORBIT-release.aab`
- `build-info.txt` (commit, ref, event, run ID, UTC timestamp, app version, version code, package ID, signing status, certificate SHA-256)
- `SHA256SUMS.txt`

Public release assets:
- `ORBIT-release.apk`
- `ORBIT-release.aab`
- `SHA256SUMS.txt`
- `build-info.txt`

Debug APK is kept as CI artifact only (not attached to public release).
Symbol artifacts (`ORBIT-symbols`): R8 `mapping.txt` and Hermes source maps when present.

Every artifact is validated before upload: all three files must exist and be non-empty, APK/AAB ZIP integrity is verified, and the application ID is confirmed as `com.orbit.app`.

## Verification status

- Local JS checks: run `npx tsc --noEmit`, `npx expo lint`, `npm test`, `npm run test:rn`.
- GitHub Actions Android run: **not claimed as passed until an actual run completes successfully**.
- Emulator smoke test: non-blocking until `ORBIT_SMOKE_REQUIRED=true`.

## Device testing

- Physical Android device: **NOT TESTED** in this environment.
- Emulator: **NOT AVAILABLE** in this environment (CI smoke test covers launch sanity).
