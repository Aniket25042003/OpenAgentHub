#!/usr/bin/env bash
#
# OpenAgentHub end-to-end smoke test.
#
# Exercises the whole stack against a fresh, ephemeral local registry:
#   init -> validate -> login -> publish -> search -> install -> verify -> run
#
# Requirements: node (>=20), uv, docker (for the container sandbox path).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REG="$ROOT/registry"
CLI="$ROOT/cli/bin/run.js"

WORK="$(mktemp -d /tmp/oah-e2e-XXXXXX)"
export AGENT_HOME="$WORK/home"
PORT="${OAH_E2E_PORT:-18777}"
REGISTRY="http://127.0.0.1:$PORT"
export REGISTRY_DATABASE_URL="sqlite+aiosqlite:///$WORK/registry.db"
export REGISTRY_STORAGE_DIR="$WORK/storage"
export REGISTRY_JWT_SECRET="e2e-secret-0123456789abcdef0123456789abcdef"

PROJ="$WORK/project"
mkdir -p "$PROJ"
mkdir -p "$AGENT_HOME"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
fail() { printf '\033[31mE2E FAILED: %s\033[0m\n' "$*" >&2; exit 1; }
assert_match() { grep -q "$2" <<<"$1" || fail "expected /$2/ in: ${1:0:300}"; }
assert_contains() { [[ "$1" == *"$2"* ]] || fail "expected to contain '$2' in: ${1:0:300}"; }

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    pkill -f "uvicorn app.main:app --port $PORT" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- start registry -----------------------------------------------------------
step "starting ephemeral registry on :$PORT"
(
  cd "$REG"
  uv run uvicorn app.main:app --port "$PORT" --log-level warning
) >"$WORK/registry.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "$REGISTRY/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
curl -fsS "$REGISTRY/health" >/dev/null 2>&1 || fail "registry did not become healthy (see $WORK/registry.log)"

# --- mint an auth token for the CLI -------------------------------------------
step "minting a test token"
TOKEN="$(cd "$REG" && uv run python - <<'PY'
import asyncio
from app.db import _session_factory
from app.models import User
from app.auth import issue_token
async def main():
    async with _session_factory() as s:
        u = User(username="e2e-user")
        s.add(u)
        await s.commit()
        await s.refresh(u)
        print(issue_token(u.id, u.username))
asyncio.run(main())
PY
)"
[[ -n "$TOKEN" ]] || fail "could not mint token"

# --- init / validate -----------------------------------------------------------
step "init + validate"
"$CLI" init demo/hello --dir "$PROJ" >/dev/null
OUT="$("$CLI" validate "$PROJ")"
assert_match "$OUT" "manifest valid: demo/hello"

# --- publish -------------------------------------------------------------------
step "publish to registry"
OUT="$("$CLI" login --token "$TOKEN" --registry "$REGISTRY")"
assert_contains "$OUT" "authenticated as e2e-user"
OUT="$("$CLI" publish "$PROJ" --registry "$REGISTRY")"
assert_contains "$OUT" "published demo/hello@0.1.0"
assert_contains "$OUT" "security scan queued"

# --- search --------------------------------------------------------------------
step "search"
OUT="$("$CLI" search hello --registry "$REGISTRY")"
assert_contains "$OUT" "demo/hello"

# --- install (untrusted -> container sandbox) ----------------------------------
step "install from registry"
OUT="$("$CLI" install demo/hello --registry "$REGISTRY" --yes)"
assert_contains "$OUT" "installed"
assert_contains "$OUT" "container sandbox"

# --- verify --------------------------------------------------------------------
step "verify signature"
OUT="$("$CLI" verify demo/hello)"
assert_contains "$OUT" "signature valid"

# --- run (container, stdin piped) ----------------------------------------------
step "run in container with piped stdin"
OUT="$(printf '{"name":"e2e"}' | "$CLI" run demo/hello --model local)"
assert_contains "$OUT" '"hello": "e2e"'

# --- secrets vault --------------------------------------------------------------
step "secrets vault (encrypted at rest)"
"$CLI" env demo/hello E2E_TOKEN=sup3rs3cret >/dev/null
OUT="$("$CLI" env demo/hello)"
assert_contains "$OUT" "E2E_TOKEN"
[[ "$OUT" != *"sup3rs3cret"* ]] || fail "plaintext secret leaked in env listing"

step "E2E PASSED"
