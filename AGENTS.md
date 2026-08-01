# AGENTS.md — OpenAgentHub

Guidance for AI agents (and new humans) working in this repository.

> Start here for the rules of the repo. For deep architecture and component
> docs, see [docs/README.md](docs/README.md) (index) and the per-component
> files under `docs/`.

## What this project is

OpenAgentHub is a **universal package manager & registry for AI agents** — "the npm for agents".
An agent is any piece of code declared by a single framework-agnostic manifest
(`agent.yaml`). Users install and run agents through three execution interfaces:

- **CLI** — one-shot: JSON in on stdin, JSON out on stdout
- **MCP** — long-running Model Context Protocol server (stdio/http)
- **HTTP** — a deployable HTTP endpoint

Everything is **signed, verified, and sandboxed by default**:

- Agents are packed into `.ahb` archives (gzip tar) and signed with an Ed25519
  key (signature lives in `<archive>.sig.json`).
- Installers verify the signature and sha256 before unpacking.
- Untrusted/unknown agents run in a hardened Docker container
  (`--cap-drop ALL`, no-new-privileges, pids/memory/cpu limits, `--network none`
  unless granted, read-only root, non-root user). Trusted/local agents use a
  fast process path with shell-metacharacter rejection.
- Secrets are stored in an AES-256-GCM vault keyed to the machine.

## Repository layout (monorepo)

```
/  root package.json — npm workspaces: sdk, cli, runtime, web
specs/       Single source of truth: agent.schema.json (JSON Schema 2020-12) + SPEC.md
sdk/         @openagenthub/sdk — TS: manifest validation, crypto, pack/unpack, runtime detection, registry client
runtime/     @openagenthub/runtime — TS: config/secrets vault/model selection/permissions/sandboxes/AgentRuntime
cli/         @openagenthub/cli — oclif CLI, bin `agent` (init, validate, publish, install, run, ...)
registry/    Python FastAPI backend: search/publish/auth/scan + archive storage
web/         Next.js 15 (App Router) registry website, points at the registry API
examples/    Reference agents: github-pr-reviewer, meeting-notes (MCP), echo-server
test/        e2e.sh — full-stack smoke test (ephemeral registry + CLI)
docs/        Human + agent reference: architecture decisions, per-component deep dives
```

## Environment / tooling

- Node >= 20 (v26.5.0 used), npm workspaces at repo root.
- Python >= 3.11 with **uv** for the registry (`registry/.venv`, `uv run ...`).
- Docker required for the container sandbox path (`docker info` must succeed).
- Tests for TS packages use Node's built-in runner: `node --test "test/*.test.ts"`
  (note: must pass the glob; plain `node --test test/` does not work).

## Commands

```bash
# build + test all TS workspaces
npm run build          # sdk -> runtime -> cli
npm run test           # build + sdk + runtime + cli tests

# registry (Python)
cd registry && uv sync --extra dev && uv run pytest -q
cd registry && uv run uvicorn app.main:app --port 8000   # run server

# end-to-end (init -> publish -> search -> install -> run) against an ephemeral registry
test/e2e.sh

# website
npm run build -w @openagenthub/web
cd web && npx next start -p 3100   # or: npm run dev -w @openagenthub/web
```

## Core invariants & decisions (keep these when changing code)

1. **The manifest is the contract.** `specs/agent.schema.json` is the single
   source of truth. Never loosen it silently; update it AND the SDK's
   `sdk/src/schema/` copy (rebuild the SDK) together.
2. **Manifest shapes** (easy to get wrong):
   - `permissions` is an **array** of strings (`["network"]`, `"none"` alone).
   - `secrets` is an **array** of env-var names (`[GITHUB_TOKEN]`).
   - `framework` is an **object** `{name, version}`; the registry stores only `name`.
   - `runtime` is `{language, python?: ">=3.10", sandbox?: auto|container|isolated-process}`.
   - `interfaces` needs at least one of `cli {command}`, `mcp {entrypoint}`,
     `http {endpoint}`.
3. **Signatures are Ed25519, base64** (see sdk `signPayload`); the registry and
   Python test helpers must base64-decode, never `bytes.fromhex`.
4. **Never embed secrets** in manifests or repos. Values live only in the vault
   (`$AGENT_HOME/master.key` machine-bound) and are injected as env at run time.
5. **Sandbox trust model**: `trusted`/`local` → process path; `untrusted`/`unknown`
   → container. The container path is the default for registry installs.
6. **Registry API is the SDK contract** — `sdk/src/registry.ts` defines the exact
   routes/shapes (`/api/v1/agents...`, `AgentSummary`, `AgentVersionDetail`).
   Keep the FastAPI implementation in lockstep. `version=latest` is an alias.
7. **SQLite for dev/tests, Postgres for prod** (`REGISTRY_DATABASE_URL`); archive
   blobs go to a configurable filesystem store (`REGISTRY_STORAGE_DIR`), not the DB.
8. **Prefer zero-dependency agent code.** Reference agents use only the Python
   stdlib so container runs need no dependency install.
9. **Don't add comments to code** unless asked; keep the codebase dense but
   self-explanatory.

## Where things live when you need them

| Need | Look in |
| --- | --- |
| Add/change manifest fields | `specs/agent.schema.json`, `specs/SPEC.md`, SDK `manifest.ts` |
| Sign/verify/pack logic | `sdk/src/crypto.ts`, `sdk/src/package.ts` |
| Trust/sandbox decision | `sdk/src/runtime.ts` (`decideSandbox`) |
| Runtime exec + env injection | `runtime/src/runtime.ts`, `runtime/src/models.ts` |
| Sandbox flags | `runtime/src/sandbox/container.ts` (docker flags), `process.ts` |
| Secrets vault | `runtime/src/secrets.ts` |
| CLI commands | `cli/src/commands/*.ts`, shared logic in `cli/src/lib/installer.ts` |
| Registry endpoints | `registry/app/routers/agents.py` (auth/keys/me alongside) |
| Website pages | `web/src/app/**` (App Router, `@/` → `web/src`) |
| Reference agents | `examples/*` |

## Gotchas learned the hard way

- macOS `tar` emits AppleDouble `._*` files; `packAgent` excludes them and sets
  `COPYFILE_DISABLE=1` — do not "simplify" that away.
- `container.ts` MUST pass `--interactive` to docker or piped stdin never reaches
  the agent (agents get empty stdin and crash on `json.load`).
- oclif `this.error(msg)` exits with **2** by default — pass `{ exit: 1 }`.
- The registry's `check_archive_safety` and manifest parsing require the exact
  basename `agent.yaml` (a `._agent.yaml` AppleDouble file previously matched
  `endswith` and broke publishing).
- `agent run` forwards piped stdin when no `--input` flag is given (see `cli/src/commands/run.ts`).
- Runtime tests: `node --test "test/*.test.ts"` (quoted glob) from each TS workspace.

## Milestone status

- M1 spec + SDK — done (30 tests)
- M6 runtime engine — done (20 tests)
- M2 CLI — done (9 tests)
- M3 registry backend — done (19 tests)
- M5 reference agents — done (3 examples)
- M4 website — done
- Security review + E2E — done (`test/e2e.sh` green)
