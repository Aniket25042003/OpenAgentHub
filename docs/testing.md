# Testing

How each layer is tested, and the e2e harness that ties them together.

## TS workspaces (SDK / runtime / CLI)

Node built-in test runner:

```bash
npm run build                 # sdk -> runtime -> cli (dependency order)
npm run test                  # build + run all three suites
```

From any TS workspace:

```bash
node --test "test/*.test.ts"
```

**Important**: the glob must be quoted. `node --test test/` (directory) does
not discover the tests. Suites: SDK 30, Runtime 20, CLI 9 (all green).

Test helper conventions:

- Tests set `AGENT_HOME` (or `AGENT_MACHINE_ID`) to a temp dir so the vault
  and config never touch the developer's real `~/.openagenthub`.
- Secrets tests pass a fixed passphrase for deterministic key derivation.
- Container sandbox argv construction is tested with a mocked docker
  (`runtime/test/runtime.test.ts`); real docker execution is skipped when
  docker isn't present.
- The CLI's stdin-piping regression test pipes JSON through `agent run`.

## Registry (Python)

```bash
cd registry
uv sync --extra dev
uv run pytest -q            # 19 tests
```

Covers: API endpoints, publish flow with signature verification
(`verify_signature`, base64), archive safety scan statuses, upload caps,
`_safe_segment` traversal guard, `version=latest` resolution, auth/JWT, and
manifest/framework handling.

## End-to-end (`test/e2e.sh`)

Full-stack smoke test against an **ephemeral** registry:

```
init -> validate -> login -> publish -> search
  -> install (untrusted -> container sandbox)
  -> verify signature -> run (container, piped stdin) -> secrets vault
```

- Starts `uv run uvicorn app.main:app` on port 18777 (or `OAH_E2E_PORT`) with a
  temp SQLite DB + storage dir and a fixed `REGISTRY_JWT_SECRET`.
- Mints a JWT by inserting a `User` row and calling `issue_token` directly.
- Uses a temp `AGENT_HOME`; the CLI runs via `cli/bin/run.js`.
- Assertions:
  - `init demo/hello` + `validate` → "manifest valid: demo/hello"
  - `login --token <jwt> --registry ...` → "authenticated as e2e-user"
  - `publish` → "published demo/hello@0.1.0" + "security scan queued"
  - `search hello` → contains "demo/hello"
  - `install demo/hello --yes` → "installed" + "container sandbox"
  - `verify demo/hello` → "signature valid"
  - `printf '{"name":"e2e"}' | run demo/hello --model local` → `"hello": "e2e"`
  - `env demo/hello E2E_TOKEN=sup3rs3cret` then `env demo/hello` → lists
    E2E_TOKEN but does NOT echo the plaintext value.
- Tears the registry down and removes the temp dirs. Requires node (>=20),
  uv, and Docker (for the container path).

## What not to break

- Manifest shapes (see `AGENTS.md` invariants) — schema tests + registry
  tests guard these.
- Signature payload format (`openagenthub-signature-v1:<name>@<version>:<sha256>`,
  base64 sigs) — SDK, registry, and e2e all exercise it.
- Piped-stdin behavior of `agent run`.
- The exact-basename manifest check (`agent.yaml`/`manifest.yaml`) —
  AppleDouble `._*` handling.
- `--interactive` on the container sandbox (stdin piping).
