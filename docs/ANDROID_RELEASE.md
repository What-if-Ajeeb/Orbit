# Android Release Readiness

## Status (honest)

- **Phase 1 Android compatibility**: partially verified by static/code checks and Expo export in this Linux container. No physical Android device available here.
- **Phase 2 RN testing**: Jest/RN harness configured; KikoAvatar + BuddyAvatar component tests pass locally; Buddy Room interaction tests still limited.
- **Phase 3 Build system**: Android Gradle config inspected/updated for signing env vars; debug/release/AAB build commands documented. **No Android SDK/JDK installed in this environment**, so APK/AAB were not built here.
- **Phase 4 Real device validation**: **NOT PERFORMED**. Physical device unavailable. Emulator unavailable (no Android SDK). Do not claim device validation.
- **Phase 5 All 16 buddies**: not complete. Kiko is reference; remaining 15 original SVG buddies not fully produced/QA'd.
- **Phase 6 GitHub release automation**: CI/build workflows added; release publication should remain manual/authorized.

## Required checks before calling ready

- [ ] `npx tsc --noEmit`
- [ ] `npx expo lint`
- [ ] `npx vitest run`
- [ ] `npx jest --runInBand`
- [ ] `npx expo export --platform android --no-bytecode --output-dir /tmp/opencode/orbit-export`
- [ ] Android debug APK builds
- [ ] Android release APK builds
- [ ] Android AAB builds
- [ ] Install/start on emulator
- [ ] Install/start on real Android device
- [ ] Kiko SVG/animations/touch/voice/background/battery-saver/reduced-motion validated on device
- [ ] No critical startup crashes
- [ ] Release signing secrets configured in GitHub/CI, not committed

## Build commands

```bash
# JS checks
npx tsc --noEmit
npx expo lint
npx vitest run
npx jest --runInBand

# Android project
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleDebug
./gradlew assembleRelease
./gradlew bundleRelease
```

## Signing

Release signing reads env vars when present:

- `ORBIT_RELEASE_STORE_FILE` - path to keystore (CI decodes base64 secret to `android/app/release.keystore`)
- `ORBIT_RELEASE_STORE_PASSWORD`
- `ORBIT_RELEASE_KEY_ALIAS`
- `ORBIT_RELEASE_KEY_PASSWORD`

Never commit keystores, passwords, or secrets. Debug signing remains default for local debug builds.

## Known blockers in this environment

- No Java/Android SDK/adb/emulator installed.
- No physical Android device connected.
- Remaining 15 buddy SVG asset sets not produced.
