# OpenAgentHub Agent Manifest Specification (v1)

The `agent.yaml` manifest is the single source of truth describing an AI agent
published to OpenAgentHub. A manifest is **framework-agnostic**: it describes
what the agent needs and how to run it, without prescribing LangGraph, CrewAI,
AutoGen, OpenHands, or any other framework. The registry stores manifests +
assets; the CLI/runtime interpret them.

## Files

- `agent.yaml` (or `manifest.yaml`) at the root of the published package.
- The authoritative schema: `specs/agent.schema.json` (JSON Schema 2020-12).
- Validators MUST reject anything not covered by the schema (strict mode:
  `additionalProperties: false`).

## Top-level fields

| Field            | Required | Description                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------------- |
| `manifestVersion`| yes      | `1` for this spec.                                                          |
| `name`           | yes      | `namespace/name`, lowercase slug. E.g. `github/pr-reviewer`.                |
| `version`        | yes      | Semantic version (SemVer 2.0.0).                                            |
| `author`         | yes      | Publisher username / identity.                                              |
| `description`    | yes      | One-line summary (max 500 chars).                                           |
| `license`        | yes      | SPDX license identifier.                                                    |
| `homepage`       | no       | Project homepage URL.                                                       |
| `repository`     | no       | Source repository URL.                                                      |
| `keywords`       | no       | Search keywords.                                                            |
| `runtime`        | yes      | `language`, optional version constraints, `sandbox` hint.                   |
| `framework`      | no       | Declared framework name + version. Informational.                           |
| `models`         | yes      | `supported` providers: openai/anthropic/google/deepseek/ollama/mistral/xai/groq/local/custom. |
| `interfaces`     | yes      | At least one of `cli`, `mcp`, `http`. How the agent is executed.            |
| `permissions`    | no       | Requested capabilities (Android-style). See below.                          |
| `dependencies`   | no       | `pip`, `npm`, `system` package lists. Installed by the runtime.             |
| `tools`          | no       | Declared tool names the agent uses (github, terminal, browser, ...).        |
| `tags`           | no       | Discovery tags (max 20).                                                    |
| `secrets`        | no       | **Names** of environment variables required at runtime (never values).      |

## Interfaces

At least one interface is required. `cli` is the default execution path.

```yaml
interfaces:
  cli:
    command: "python -m pr_reviewer"     # run in the sandbox working directory
    input: json                          # json | args | stdin
    output: json                         # json | text
  mcp:
    entrypoint: "python mcp_server.py"   # the agent IS an MCP server
    transport: stdio                     # stdio | http | sse
  http:
    endpoint: "https://api.example.com/review"
    methods: [POST]
```

## Permissions

Permissions are **requested**, never enforced by the manifest. The runtime
decides, with user consent, whether to grant them.

```yaml
permissions: [filesystem, network, github, terminal]
```

Allowed values: `filesystem`, `network`, `github`, `terminal`, `browser`,
`camera`, `microphone`, `none`.

## Dependencies

```yaml
dependencies:
  pip: ["langgraph>=0.2", "httpx"]
  npm: ["zod"]
  system: ["git"]
```

## Models & secrets

The agent declares the model providers it supports. At runtime the user (or the
runtime) picks one; the runtime injects configuration via environment:

| Variable              | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `AGENT_MODEL_PROVIDER`| Selected provider, e.g. `deepseek`       |
| `AGENT_MODEL_NAME`    | Selected model name, e.g. `deepseek-chat`|
| `AGENT_BASE_URL`      | Provider base URL (for local/Ollama)     |
| `AGENT_API_KEY`       | API key injected from the secrets vault  |

The manifest's `secrets` field lists which additional env var *names* the agent
needs (e.g. `GITHUB_TOKEN`). Values are stored only in the user's encrypted
secrets vault and injected by the runtime.

## Security model

1. **Signed packages.** Every published artifact is signed (Ed25519) by the
   publisher. The signature binds the tarball SHA-256 + name + version.
2. **Strict extraction.** The CLI never extracts paths that are absolute,
   escape the install directory, or contain symlinks pointing outside.
3. **Trust tiers.** Agents from verified publishers that pass automated scanning
   run in an isolated process (venv/node_modules). Untrusted agents run in a
   container with dropped capabilities, no-new-privileges, and read-only
   filesystem unless `filesystem` permission is granted.
4. **Scans.** The registry scans every published version: secrets detection,
   dangerous shell commands, dependency vulnerabilities (pip-audit / npm audit),
   license validation, signature verification.
5. **Secrets vault.** Agent env values are encrypted (AES-256-GCM) locally.
