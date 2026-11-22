# Android Release / CI Status

## Environment diagnosis (this container)

- OS: Linux container; `java`, `javac`, `adb`, Android SDK, Gradle not installed. `JAVA_HOME` unset.
- Expo SDK: `~58.0.26`, React Native: `0.88.1`, `react-native-svg`: `15.16.0` (from `package.json`).
- Android config present: `android/` project, Gradle wrapper `9.4.1`, `android.enableMinifyInReleaseBuilds=true`, Hermes/new arch enabled, package `com.orbit.app`.
- **Conclusion**: Local Android APK/AAB builds are **not supported in this environment**. Android builds must run in GitHub Actions (or a machine with JDK 17 + Android SDK).

## GitHub Actions workflows

- `.github/workflows/ci.yml` - JS validation on push/PR: `npm ci`, `tsc`, `expo lint`, `vitest`, `jest`.
- `.github/workflows/android-ci.yml` - consolidated Android workflow on push to `main`, PR to `main`, tag `v*`, and manual dispatch. It runs JS checks, sets up JDK 17 + Android SDK, prebuilds, builds debug APK, builds release APK+AAB, uploads artifacts. On `v*` tags it attaches artifacts to the GitHub Release.
- `.github/workflows/android-release.yml` was removed to avoid conflicting duplicate release workflows.
- `.github/workflows/android-logcat3.yml` remains diagnostic-only; it does not publish production releases.

## Required GitHub secrets (for real signed release)

Configure in GitHub repo secrets only; never commit:

- `ORBIT_RELEASE_STORE_FILE` - base64-encoded keystore file
- `ORBIT_RELEASE_STORE_PASSWORD`
- `ORBIT_RELEASE_KEY_ALIAS`
- `ORBIT_RELEASE_KEY_PASSWORD`

If secrets are missing, workflow still builds APK/AAB but release artifacts are debug-signed fallback; `artifacts/build-info.txt` records this.

## Artifact names

- `ORBIT-debug.apk`
- `ORBIT-release.apk`
- `ORBIT-release.aab`
- `build-info.txt`

## Validation status

- Local JS checks: passed before push (`tsc`, `expo lint`, `vitest`, `jest`).
- GitHub Actions Android run: **not claimed as passed until an actual run completes successfully**. After pushing workflow, inspect Actions run logs/artifacts.

## Device testing

- Physical Android device: **NOT TESTED** in this environment.
- Emulator: **NOT AVAILABLE** in this environment.
- Kiko/Buddy Room/SVG/gestures/animation/evolution confirmation need real device or emulator validation.

## Remaining blockers

- No local Android SDK/JDK - cannot produce local APK/AAB here.
- Signed release pending until GitHub secrets are configured.
- Real device/emulator validation pending.
- Remaining 15 original Buddy SVG packs not started (intentionally deferred until Kiko validation).
