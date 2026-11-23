#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path required}"
PACKAGE="${2:-com.orbit.app}"
LOGCAT_FILE="${LOGCAT_FILE:-logcat.txt}"

if [ ! -f "$APK_PATH" ]; then
  echo "::error::APK not found: $APK_PATH"
  exit 1
fi

adb wait-for-device
adb uninstall "$PACKAGE" >/dev/null 2>&1 || true
adb install -r "$APK_PATH"
adb logcat -c
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1

sleep 25

adb logcat -d -v threadtime > "$LOGCAT_FILE" || true

pid="$(adb shell pidof "$PACKAGE" | tr -d '\r' || true)"
if [ -z "$pid" ]; then
  echo "::error::App process $PACKAGE is not running after launch."
  tail -n 200 "$LOGCAT_FILE" || true
  exit 1
fi

if grep -E "FATAL EXCEPTION|ANR in ${PACKAGE}|ANR in " "$LOGCAT_FILE" | grep -q "$PACKAGE\|FATAL EXCEPTION"; then
  echo "::error::Detected crash/ANR indicators for $PACKAGE in logcat."
  grep -nE "FATAL EXCEPTION|ANR in ${PACKAGE}|${PACKAGE}" "$LOGCAT_FILE" | tail -n 120 || true
  exit 1
fi

echo "Smoke test passed: $PACKAGE pid=$pid"
