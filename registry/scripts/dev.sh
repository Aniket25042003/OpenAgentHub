#!/usr/bin/env bash
# One-command local development: API + all workers together.
# Usage: scripts/dev.sh
set -euo pipefail

cd "$(dirname "$0")/.."

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

uv run uvicorn app.main:app --port "${REGISTRY_PORT:-8000}" &
pids+=("$!")

for worker in scan notifications billing maintenance; do
  uv run python -m "app.workers.${worker}" &
  pids+=("$!")
done

echo "registry API on http://localhost:${REGISTRY_PORT:-8000} (workers: scan, notifications, billing, maintenance)"
wait
