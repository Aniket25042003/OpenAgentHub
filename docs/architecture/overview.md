# Architecture Overview

OpenAgentHub is a **universal package manager and registry for AI agents** —
"the npm for agents". An agent is any piece of code declared by a single,
framework-agnostic manifest (`agent.yaml`). The whole system is built around
signing, verification, and sandboxing so that installing an agent is as safe
as installing a package.

## Components

```
                         ┌─────────────────────┐
                         │      Website        │  Next.js 15 (web/)
                         │  browse + search +  │  reads registry API
                         │  install commands   │
                         └─────────┬───────────┘
                                   │ HTTP (JSON)
                         ┌─────────▼───────────┐
                         │      Registry       │  FastAPI (registry/)
                         │  search / publish / │  SQLite (dev) / Postgres (prod)
                         │  scan / auth        │  filesystem archive store
                         └─────────┬───────────┘
                                   │ HTTP (JSON / multipart / archive)
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│     CLI      │          │      SDK     │          │  (third-party │
│ agent (cli/)│ ────────► │ @openagenthub │ ◄─────── │  clients )    │
│ install/run/│  import   │ /sdk         │  import  └──────────────┘
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

## The agent lifecycle

1. **Author** writes an agent: `agent.yaml` manifest + code (Python, Node, ...).
2. **Pack** (`agent publish`): packs the directory into an `.ahb` archive
   (gzip tar) and signs it with an Ed25519 key. Output: `<name>_<version>.ahb`
   + `<name>_<version>.ahb.sig.json`. See [packaging.md](packaging.md).
3. **Registry**: `PUT /api/v1/agents/{ns}/{name}/versions/{version}` uploads
   the archive + signature file. The registry re-verifies the signature,
   scans the archive (`check_archive_safety`), stores it, and records a
   security status (`clean` / `flagged`).
4. **Install** (`agent install ns/name`): fetches the archive, re-verifies the
   signature (sha256 + Ed25519 + key fingerprint), unpacks strictly into
   `$AGENT_HOME/agents/{ns}/{name}/{version}/`, records trust + granted
   permissions in `config.json`:
   - registry install → `unknown` (or `untrusted` if flagged) → **container**
   - local directory install (`--dir`) → `local` → **isolated-process**
5. **Run** (`agent run ns/name --model openai`): reads stdin (JSON), injects
   model + secret env, and executes the agent in the chosen sandbox. Output is
   JSON on stdout.

## Interface types

An agent declares at least one execution interface:

- **CLI** (`interfaces.cli.command`): one-shot. JSON on stdin, JSON on stdout.
  This is the workhorse for tasks like "review this PR".
- **MCP** (`interfaces.mcp.entrypoint`): long-running Model Context Protocol
  server over stdio. Run with `agent run ... --interface mcp --interactive`.
- **HTTP** (`interfaces.http.endpoint`): a deployable endpoint. The local
  runtime just reports the endpoint; a hosted deployment serves it.

## Data flow for one `agent run`

```
agent run ns/name --model openai
  ├─ find installed record in config.installed
  ├─ load manifest (loadManifestFromDir)
  ├─ granted = grantedPermissions(config, agentKey)
  ├─ vault = SecretsVault.open()
  └─ AgentRuntime(vault).runAgent({
       agentDir, manifest, agentKey, interfaceName,
       input (piped stdin or --input), granted, trustLevel,
       model, timeoutMs, interactive
     })
       ├─ pickModel(manifest, model, vault, agentKey)   → provider + model + key
       ├─ buildAgentEnv(...) + secrets → env
       ├─ decideSandbox(manifest, detected, trustLevel) → container | isolated-process
       ├─ new ContainerSandbox / ProcessSandbox
       └─ sandbox.run({ command, input, timeoutMs })
```

## Security model (summary)

- **Package integrity**: Ed25519 signature over
  `openagenthub-signature-v1:<name>@<version>:<sha256>`; sha256 of the archive.
  Verified at publish (registry) and at install (client).
- **Package safety**: strict unpacking rejects path traversal, absolute paths,
  symlinks, device nodes, oversized members; the registry statically scans
  before marking an archive clean/flagged.
- **Isolation**: container sandbox by default for anything not explicitly
  trusted; hardened docker flags. Process path only for trusted/local and
  rejects shell metacharacters.
- **Secrets**: never stored in the clear; AES-256-GCM vault with a machine-
  bound derived key.
- **Permissions**: agents must declare capabilities (`network`, `filesystem`,
  ...); users grant them explicitly at install (or via `--yes`).

See [trust-model.md](trust-model.md), [packaging.md](packaging.md),
[secrets.md](secrets.md), and [execution.md](execution.md) for details.
