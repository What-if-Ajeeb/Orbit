#!/usr/bin/env bash
# Ollama ko hamesha ON rakhne wala watcher.
# Har 10 second me check karta hai; server gire to khud restart kar deta hai.
set -euo pipefail

PORT="${OLLAMA_PORT:-11434}"
HOST="${OLLAMA_HOST:-0.0.0.0}"
LOG="${OLLAMA_LOG:-/root/orbit/lockllm/logs/ollama.log}"
WATCH_LOG="${OLLAMA_WATCH_LOG:-/root/orbit/lockllm/logs/ollama-watchdog.log}"
PID_FILE="${OLLAMA_WATCH_PID:-/root/orbit/lockllm/logs/ollama-watchdog.pid}"

mkdir -p "$(dirname "$LOG")" "$(dirname "$WATCH_LOG")"

# Ek hi watcher chalna chahiye
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Watchdog already chal raha hai (pid $(cat "$PID_FILE"))"
  exit 0
fi
echo $$ >"$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

echo "$(date) - Ollama watchdog shuru" >>"$WATCH_LOG"

while true; do
  if ! curl -fsS "http://127.0.0.1:${PORT}/api/version" >/dev/null 2>&1; then
    echo "$(date) - Server nahi mila, restart kar rahe hain" >>"$WATCH_LOG"
    OLLAMA_HOST="${HOST}:${PORT}" OLLAMA_ORIGINS="${OLLAMA_ORIGINS:-*}" \
      nohup ollama serve >>"$LOG" 2>&1 &
    sleep 5
  fi
  sleep 10
done
