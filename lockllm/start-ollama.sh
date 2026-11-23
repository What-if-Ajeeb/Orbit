#!/usr/bin/env bash
# Ollama server start karne ke liye (systemd nahi hai is container mein)
set -euo pipefail

PORT="${OLLAMA_PORT:-11434}"
HOST="${OLLAMA_HOST:-0.0.0.0}"
LOG="${OLLAMA_LOG:-/root/orbit/lockllm/logs/ollama.log}"

mkdir -p "$(dirname "$LOG")"

if curl -fsS "http://127.0.0.1:${PORT}/api/version" >/dev/null 2>&1; then
  echo "Ollama already chal raha hai: http://127.0.0.1:${PORT}"
  exit 0
fi

export OLLAMA_HOST="${HOST}:${PORT}"
# Browser app ko link karne ke liye origins allow karein
export OLLAMA_ORIGINS="${OLLAMA_ORIGINS:-*}"

nohup ollama serve >>"$LOG" 2>&1 &
echo "Ollama shuru ho gaya (pid $!) -> http://127.0.0.1:${PORT}"
echo "Log file: ${LOG}"
