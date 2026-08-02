# OpenAgentHub

**The universal package manager & registry for AI agents — "the npm for agents".**

OpenAgentHub lets you publish, discover, install, and run AI agents the same way
you install software packages. An agent is any piece of code declared by a
single, framework-agnostic manifest (`agent.yaml`). Everything is **signed,
verified, and sandboxed by default**, so installing an agent you didn't write is
as safe as installing a package.

```bash
# one-shot agent: JSON in, JSON out
printf '{"repo":"acme/app","pr":42}' | agent run github/pr-reviewer

# long-running Model Context Protocol server
agent run acme/meeting-notes --interface mcp --interactive

# deployable HTTP endpoint
agent run acme/echo-server --interface http
```

Agents can be written in any language (Python, Node, ...) using any framework
(LangGraph, CrewAI, AutoGen, or none at all) — the manifest is the contract.

---

## Features

- **Three execution interfaces** — every agent declares at least one:
  - **CLI** — one-shot: JSON on stdin, JSON on stdout
  - **MCP** — long-running Model Context Protocol server (stdio/http/sse)
  - **HTTP** — a deployable HTTP endpoint
- **Signed packages** — agents are packed into `.ahb` archives (gzip tar) and
  signed with an **Ed25519** key; the signature binds the archive SHA-256,
  name, and version.
- **Verified at both ends** — the registry re-verifies signatures on publish;
  the CLI re-verifies on install before unpacking.
- **Sandboxed by default** — untrusted/unknown agents run in a hardened Docker
  container (`--cap-drop ALL`, no-new-privileges, pids/memory/cpu limits,
  `--network none` unless granted, read-only root, non-root user). Trusted and
  local agents use a fast process path with shell-metacharacter rejection.
- **Encrypted secrets vault** — agent env values are stored in an AES-256-GCM
  vault keyed to the machine (`$AGENT_HOME/master.key`); values never live in
  manifests or repos.
- **Android-style permissions** — agents declare the capabilities they need
  (`network`, `filesystem`, `github`, ...); you grant them explicitly at install.
- **Security scanning** — the registry scans every published version for unsafe
  archive paths, missing manifests, oversized members, etc., and flags findings.
- **Self-hostable registry + website** — a FastAPI backend and a Next.js front
  end you can run anywhere.
- **System dashboard & diagnostics** — the website homepage is a live dashboard
  (and `agent status`/`agent ps` expose the same data to the CLI) showing the
  agents installed on your machine, running Docker containers, and detected
  third-party agents (OpenClaw, Hermes, …).

---

## Architecture

```
                         ┌─────────────────────┐
                         │      Website        │  Next.js 15 (web/)
                         │  browse + search    │  reads registry API
                         └─────────┬───────────┘
                                   │ HTTP (JSON)
                         ┌─────────▼───────────┐
                         │      Registry       │  FastAPI (registry/)
                         │  search / publish / │  SQLite (dev) / Postgres (prod)
                         │  scan / auth        │  filesystem archive store
                         └─────────┬───────────┘
                                   │ HTTP (JSON / multipart / archive)
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼                         ▼                         ▼
 ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
 │     CLI      │          │     SDK      │          │ third-party  │
 │ agent (cli/) │ ───────► │ @openagenthub│ ◄─────── │  clients     │
 │ install/run/ │  import  │     /sdk     │  import  └──────────────┘
 └──────┬───────┘          └──────┬───────┘
        │                         │
        ▼                         ▼
 ┌──────────────────────────────────────┐
 │              Runtime                 │  @openagenthub/runtime (runtime/)
 │  AgentRuntime.runAgent()             │
 │  ├── pickModel() + buildAgentEnv()   │  ── model env
 │  ├── vault secrets → env             │  ── SecretsVault
 │  ├── decideSandbox(trust)            │  ── container | isolated-process
 │  └── sandbox.run()                   │  ── CLI / MCP / HTTP interface
 └──────────────────────────────────────┘
```

### The agent lifecycle

1. **Author** writes an agent: `agent.yaml` manifest + code.
2. **Pack** (`agent publish`): packs the project directory into an `.ahb`
   archive (gzip tar) and signs it with an Ed25519 key, producing
   `<name>_<version>.ahb` + `<name>_<version>.ahb.sig.json`.
3. **Registry**: `PUT /api/v1/agents/{ns}/{name}/versions/{version}` uploads the
   archive + signature. The registry re-verifies the signature, statically scans
   the archive, stores it, and records a security status (`clean`/`flagged`).
4. **Install** (`agent install ns/name`): fetches the archive, re-verifies the
   signature (SHA-256 + Ed25519 + key fingerprint), unpacks strictly into
   `$AGENT_HOME/agents/{ns}/{name}/{version}/`, and records trust + granted
   permissions.
5. **Run** (`agent run ns/name --model openai`): reads stdin (JSON), injects
   model + secret env, and executes the agent in the chosen sandbox. Output is
   JSON on stdout.

---

## Repository layout

```
/                       root package.json — npm workspaces: sdk, cli, runtime, web, marketing
specs/                  Single source of truth: agent.schema.json (JSON Schema 2020-12) + SPEC.md
sdk/                    @openagenthub/sdk — TS: manifest validation, crypto, pack/unpack, runtime detection, registry client
runtime/                @openagenthub/runtime — TS: config, secrets vault, model selection, permissions, sandboxes, AgentRuntime, system detection
cli/                    @openagenthub/cli — oclif CLI, bin `agent` (init, validate, publish, install, run, status, ps, ...)
registry/               Python FastAPI backend: search/publish/auth/scan + archive storage
web/                    Next.js 15 (App Router) system dashboard + registry browse (ships with the package)
marketing/              Standalone static landing site (Next.js, `output: "export"`) — product + install docs
examples/               Reference agents: github-pr-reviewer, meeting-notes (MCP), echo-server
test/                   e2e.sh — full-stack smoke test (ephemeral registry + CLI)
docs/                   Human + agent reference: architecture decisions, per-component deep dives
AGENTS.md               Ground rules for AI agents and new contributors
```

---

## Prerequisites

- **Node.js >= 20** (npm workspaces at repo root)
- **Python >= 3.11** with [uv](https://docs.astral.sh/uv/) for the registry
- **Docker** for the container sandbox path (`docker info` must succeed)

```bash
# check your local tooling from anywhere in the repo
agent runtime
```

---

## Quickstart

```bash
# 1. Install dependencies and build all TS workspaces
npm install
npm run build                 # sdk -> runtime -> cli

# 2. Run the test suites
npm test                      # build + sdk + runtime + cli tests
npm run test:registry         # registry (pytest, requires uv)
test/e2e.sh                   # full-stack smoke test (spins up an ephemeral registry)

# 3. Start the registry (separate terminal)
cd registry && uv sync --extra dev
uv run uvicorn app.main:app --port 8000

# 4. Start the website (optional, separate terminal)
npm run dev -w @openagenthub/web   # or: npm run build -w @openagenthub/web && cd web && npx next start -p 3100

# 5. Marketing / landing site (optional, separate workspace)
npm run dev -w @openagenthub/marketing     # dev server
npm run build -w @openagenthub/marketing   # static export -> marketing/out/
npm run preview -w @openagenthub/marketing # serve the built site on :4000
```

The website defaults to `http://localhost:8000` for the registry API
(`NEXT_PUBLIC_REGISTRY_URL` to override). The marketing site is standalone and
needs neither the registry nor the dashboard.

---

## Try it end to end

```bash
# Scaffold an agent project
agent init demo/hello --dir ./hello

# Validate the manifest + local runtime requirements
agent validate ./hello

# Package + sign locally (no upload)
agent publish ./hello --public-only

# Start a local registry, then authenticate and publish
# (in test/e2e.sh the token is minted against an ephemeral registry)
agent login --token <GITHUB_TOKEN> --registry http://localhost:8000
agent publish ./hello --registry http://localhost:8000

# Search, install, verify, and run
agent search hello --registry http://localhost:8000
agent install demo/hello --registry http://localhost:8000 --yes
agent verify demo/hello
printf '{"name":"world"}' | agent run demo/hello --model local
```

The reference agent `aniketpatel/echo-server` is the simplest example to clone.

---

## The agent manifest (`agent.yaml`)

The manifest is the **single source of truth** for what an agent is. It is
framework-agnostic and validated strictly against
[`specs/agent.schema.json`](specs/agent.schema.json) (JSON Schema 2020-12, with
`additionalProperties: false`).

```yaml
manifestVersion: 1
name: acme/pr-reviewer            # namespace/name, lowercase slug
version: 1.0.0                    # SemVer
author: acme
description: Reviews GitHub pull requests
license: MIT

runtime:
  language: python                # python | node | go | rust | other
  python: ">=3.10"
  sandbox: auto                   # auto | container | isolated-process

framework:                        # optional, informational
  name: openagenthub
  version: 0.1.0

models:
  supported: [openai, anthropic, deepseek, ollama, local]

interfaces:                       # at least one required
  cli:
    command: "python main.py"
    input: json
    output: json
  mcp:
    entrypoint: "python mcp_server.py"
    transport: stdio
  http:
    endpoint: "https://api.example.com/review"
    methods: [POST]

permissions: [network]            # filesystem | network | github | terminal | browser | camera | microphone | none
secrets: [GITHUB_TOKEN]           # env-var NAMES only, never values
dependencies:
  pip: ["httpx"]
  npm: []
  system: []
tags: [github, code-review]
```

Key rules (easy to get wrong):

- `permissions` is an **array** of strings; `"none"` alone is the default.
- `secrets` is an **array** of env-var *names*; values live only in the vault.
- `framework` is an **object** `{name, version}`; the registry stores only `name`.
- `runtime` is `{language, python?, node?, sandbox?}`.
- `interfaces` needs at least one of `cli {command}`, `mcp {entrypoint}`,
  `http {endpoint}`.

At runtime the agent receives model configuration via environment variables:

| Variable               | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `AGENT_MODEL_PROVIDER` | Selected provider, e.g. `deepseek`        |
| `AGENT_MODEL_NAME`     | Selected model name, e.g. `deepseek-chat` |
| `AGENT_BASE_URL`       | Provider base URL (for local/Ollama)      |
| `AGENT_API_KEY`        | API key injected from the secrets vault   |

Plus `AGENT_NAME`, `AGENT_VERSION`, `AGENT_TRUST`, `AGENT_HOME`,
`AGENT_GRANTED_PERMISSIONS`, and any declared secrets.

---

## CLI reference (`agent`)

| Command | Description |
| --- | --- |
| `agent init <namespace/name>` | Scaffold a new agent project with an `agent.yaml` manifest |
| `agent validate [dir]` | Validate the manifest and check local runtime requirements (`--json`) |
| `agent publish [dir]` | Package, sign, and publish an agent to the registry (`--public-only` to skip upload) |
| `agent login --token <GH>` | Authenticate with the registry using a GitHub token |
| `agent search [query]` | Search the registry (filter by `--framework`, `--tags`, `--models`; sort by `--sort`) |
| `agent install <spec>` | Install from the registry, a `.ahb` file (`--file`), or a local dir (`--dir`) |
| `agent verify <spec>` | Verify the signature + integrity of an installed agent |
| `agent run <spec>` | Run an installed agent (`--model`, `--interface`, `--input`, `--interactive`, `--timeout`) |
| `agent env <spec>` | Manage encrypted secrets for an agent (`KEY=VALUE`, `--delete`, `--reveal`) |
| `agent list` | List installed agents and their granted permissions |
| `agent update <spec>` | Update an installed agent to the latest version |
| `agent uninstall <spec>` | Remove an installed agent |
| `agent runtime` | Detect local runtimes and tooling |
| `agent status` | System + agent diagnostics: host, docker, registry, installed agents, detected third-party agents (`--json`, `--all`) |
| `agent ps` | List Docker containers (default: only OpenAgentHub's own) — `--all` for every container |

Agent specs are `namespace/name[@version]`. `version=latest` is an alias.
Piped stdin is forwarded to the agent when no `--input` flag is given.

### Examples

```bash
# install and run an agent from the registry
agent install acme/pr-reviewer --yes
printf '{"repo":"acme/app","pr":42}' | agent run acme/pr-reviewer --model deepseek

# run an MCP server interactively
agent run acme/meeting-notes --interface mcp --interactive

# store a secret, then run with it injected
agent env acme/pr-reviewer GITHUB_TOKEN=ghp_...
printf '{"repo":"acme/app","pr":7}' | agent run acme/pr-reviewer
```

---

## System dashboard

The website homepage (and the `agent status` / `agent ps` commands) give you a
single local view of everything agent-related on your machine — no technical
knowledge required.

- **Host card** — OS, arch, CPU/memory, uptime, and Docker server version.
- **Installed agents** — the OpenAgentHub agents installed via `agent install`,
  with namespace/name, version, and sandbox mode.
- **Detected agents** — third-party agents that were *not* installed through
  OpenAgentHub (e.g. OpenClaw, Hermes Agent) are auto-detected by matching
  processes, config files, config directories, and listening ports against a
  pluggable catalog (`runtime/src/system/catalog.ts`).
- **Containers** — Docker containers, with an `openagenthub/*` image flag and a
  per-row `docker ps` style command; `--all` shows non-OpenAgentHub containers
  too.

The dashboard polls a local-only API endpoint (`/api/system`) every few seconds.
Registry browsing/search lives at `/browse`; the dashboard is `/`.

```bash
agent status          # human-readable system + agent summary
agent status --json   # machine-readable snapshot
agent ps              # OpenAgentHub containers
agent ps --all        # every container on the machine
```

---

## Marketing / landing website

The `marketing/` workspace is a **separate, standalone website** — the public
product page for OpenAgentHub. Unlike the dashboard above, it ships no code,
talks to no registry, and has no API: it is purely informational (product pitch,
features, how-it-works, and step-by-step install instructions via npm, Homebrew,
and a binary download). It shares the same light theme and fonts as the
dashboard.

It is a static site: `next.config.mjs` sets `output: "export"`, so the build
produces a plain `out/` directory with no server runtime. Host it anywhere that
serves static files (Nginx, GitHub Pages, Netlify, Vercel, S3, ...).

### Run it locally

```bash
# 1. Development server with hot reload
npm run dev -w @openagenthub/marketing
# -> http://localhost:3000

# 2. Production build (static export -> marketing/out/)
npm run build -w @openagenthub/marketing

# 3. Preview the built site locally
npm run preview -w @openagenthub/marketing
# -> http://localhost:4000  (serves marketing/out/ via python3 http.server)
```

> `npm run dev` and the preview both default to port 3000/4000 respectively. If
> those are taken, pass a custom port to Next (`next dev -p 3100`) or to the
> static server (`python3 -m http.server 4100 -d marketing/out`).

### Deploy it

The static export lives in `marketing/out/` after `npm run build`. Deploy that
directory as-is:

- **Nginx** — point `root` at `marketing/out;` (no proxy, no Node needed).
- **GitHub Pages** — publish `marketing/out/` to your Pages branch or use an
  action with `output: marketing/out`.
- **Vercel / Netlify** — set the framework to Next.js and the root directory to
  `marketing/`; the export is built automatically.
- **Any static host / CDN** — upload the contents of `marketing/out/`.

Because it is fully static, there is no server to keep alive, scale, or patch.
All fonts are self-hosted at build time, so there is no external CDN dependency
either.

### Structure

```
marketing/
├── next.config.mjs        output: "export" (static site)
├── package.json           next 15, react, typescript — no runtime/sdk deps
└── src/
    ├── app/
    │   ├── layout.tsx     root layout: sticky header (nav + CTAs) + footer
    │   ├── page.tsx       single landing page: hero, features, steps, install, CTA
    │   └── globals.css    light-theme design tokens + landing components
```

See [marketing/README.md](marketing/README.md) for details. Keep the design
tokens in `marketing/src/app/globals.css` in sync with
`web/src/app/globals.css` so the two sites read as one product.

---

## Security model

1. **Signed packages.** Every published artifact is signed (Ed25519) by the
   publisher. The signature binds the tarball SHA-256 + name + version
   (`openagenthub-signature-v1:<name>@<version>:<sha256>`). Signatures use
   base64, never hex.
2. **Strict extraction.** The CLI never extracts paths that are absolute,
   escape the install directory, contain NUL bytes, `..` traversal, or
   symlinks/device nodes; file sizes and counts are capped (zip-bomb defense)
   and modes are masked.
3. **Trust tiers.**
   - `trusted` / `local` → fast isolated-process path (rejects shell
     metacharacters in the command).
   - `untrusted` / `unknown` → hardened Docker container: `--cap-drop ALL`,
     `no-new-privileges`, pids/memory/cpu limits, `--network none` unless
     `network` is granted, read-only root (writable tmpfs when `filesystem` is
     granted), non-root user. Containers run with `--interactive` so piped
     stdin reaches the agent.
4. **Scans.** The registry scans every published version before marking it
   `clean`/`flagged`, and `agent verify` re-checks installed archives.
5. **Secrets vault.** Agent env values are encrypted (AES-256-GCM) in
   `$AGENT_HOME/secrets/`, keyed by a machine-bound key at
   `$AGENT_HOME/master.key`. Values are never printed in listings.

---

## Development

```bash
# build all TS workspaces (sdk -> runtime -> cli)
npm run build

# run all TS tests (Node's built-in test runner)
npm test

# registry tests (from registry/)
cd registry && uv sync --extra dev && uv run pytest -q

# end-to-end smoke test (init -> publish -> search -> install -> verify -> run)
test/e2e.sh
```

Notes:

- TS package tests use `node --test "test/*.test.ts"` — the glob must be quoted.
- The registry uses SQLite for dev/tests (`REGISTRY_DATABASE_URL`) and Postgres
  for production; archive blobs go to a filesystem store
  (`REGISTRY_STORAGE_DIR`), not the database.
- Set `REGISTRY_JWT_SECRET` before deploying the registry publicly.
- There are no code comments by design — see `docs/` for the "why".

### Repository conventions

- The manifest is the contract — `specs/agent.schema.json` is the single source
  of truth; the SDK's `sdk/src/schema/` copy must be updated in lockstep.
- `sdk/src/registry.ts` defines the exact registry API contract; keep the
  FastAPI implementation in lockstep.
- Reference agents prefer **zero dependencies** (Python stdlib only) so
  container runs need no dependency install.
- Do not add code comments unless asked.

---

## Documentation

- `docs/README.md` — index into the full docs tree (architecture, trust model,
  packaging, secrets, execution, per-component deep dives, ADRs).
- `specs/SPEC.md` — the agent manifest specification.
- `AGENTS.md` — ground rules, invariants, and gotchas for AI agents and new
  contributors.

## Milestone status

| Milestone | Status |
| --- | --- |
| M1 spec + SDK | done (30 tests) |
| M2 CLI | done (9 tests) |
| M3 registry backend | done (19 tests) |
| M4 website | done |
| M5 reference agents | done (3 examples) |
| M6 runtime engine | done (20 tests) |
| Security review + E2E | done (`test/e2e.sh` green) |

---

## License

[Apache License 2.0](LICENSE)
