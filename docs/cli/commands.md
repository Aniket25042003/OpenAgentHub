# CLI — Commands reference

Per-command behavior. Flags shown are the ones that matter; run
`agent <cmd> --help` for the full list.

## `agent init ns/name`

- Flags: `--dir`, `--python`, `--node`, `--force`.
- Scaffolds `agent.yaml` + `app.py` (python) or `index.js` (node) +
  `README.md` + `.gitignore` into `./<name>` (or `--dir`).
- Manifest template: `manifestVersion: 1`, `name: ns/name`, `version: 0.1.0`,
  author = current OS username, `runtime.language`, `models.supported` list,
  a `cli` interface, empty permissions/dependencies, `tags: [agent]`.
- Refuses to overwrite existing files without `--force`.

## `agent validate [dir]`

- Flags: `--json`.
- Loads + validates the manifest, runs `checkAgentRequirements` against the
  detected environment (python/node versions, docker if `sandbox: container`).
- Text output: `manifest valid: ns/name@version (path)` then per-requirement
  `ok`/`warn` lines; exits 1 if requirements are unsatisfied.
- `--json` emits `{ valid, manifestPath, manifest, requirements }`.

## `agent login --token T [--registry URL]`

- Stores the token and registry URL in `config.json`; verifies with
  `GET /api/v1/me`. If unreachable, stores anyway and warns.
- `--registry` defaults to `https://registry.openagenthub.dev`.

## `agent publish [dir]`

- Flags: `--registry`, `--public-only`.
- Loads/creates the signing key at `$AGENT_HOME/keys/id_ed25519` (+ `.pub`),
  runs `packAgent` (excludes AppleDouble `._*`, sets `COPYFILE_DISABLE=1`).
- Requires `config.token` (from `agent login`), calls `me()`,
  `uploadPublicKey(publicKey)`, then `publish(...)` and `triggerScan(...)`.
- Output includes archive path, sha256, publisher key id, and
  `published ns/name@version` + `security scan queued`.

## `agent install ns/name[@version]`

- Flags: `--file <archive.ahb>`, `--dir <path>` (dev mode), `--registry`,
  `--yes`, `--no-permissions`, `--force`.
- Registry install: resolve version (`latest` alias) → `downloadArchive` →
  `verifySignatureFileStrict` → strict `unpackAgent` → record in config.
  Prints trust + source; warns "will run in a container sandbox" for
  unknown/untrusted, or "running without sandbox isolation" for local.
- Prompts for each declared permission unless `--yes`/`--no-permissions`.
- Stores `signature.sig.json` + `archive.ahb` in the installed dir (used by
  `agent verify`).

## `agent update ns/name`

- Lists published versions, installs the newest via `installAgent`.
- Flags: `--registry`, `--yes`.

## `agent list`

- Prints installed agents (name, version, author, trust, installed date) plus
  their granted permissions. Reads `config.json` `installed` + `permissions`.

## `agent uninstall ns/name[@version]`

- Removes the installed directory, drops `installed`/`permissions` records,
  and deletes the agent's vault secrets.

## `agent run ns/name[@version]`

- Flags: `--model` (e.g. `deepseek` or `openai:gpt-4o`), `--interface`
  (`cli`|`mcp`|`http`, default cli), `--input JSON`, `--interactive`,
  `--timeout ms` (default 120_000), `--agent-home`.
- Requires the agent to be installed (suggests `agent install ...`).
- Reads **piped stdin** when `--input` absent and stdin isn't a TTY.
- Constructs `AgentRuntime(vault)`, calls `runAgent` with granted permissions
  from config, the installed trust level, and the model flag.
- Writes stdout/stderr; exits with the agent's exit code. `--interactive`
  wires the terminal to the child (used for MCP stdio).

## `agent verify ns/name[@version]`

- Loads the installed manifest, then `verifySignatureFileStrict` on the stored
  `archive.ahb` + `signature.sig.json`.
- Dev installs (no signature file) → warning; manifest still checked.
- Success prints `signature valid (publisher key <id>)`, sha256, integrity ok.

## `agent env ns/name[@version]`

- Flags: `--delete KEY`, `--reveal KEY`, `--passphrase`.
- With no extra args: lists secret names for the agent.
- `agent env ns/name KEY=VALUE ...` stores (encrypted, merged) — names must
  match `^[A-Z][A-Z0-9_]*$`.
- `--reveal` prints a value (use with care); `--delete` removes one.

## `agent search [query]`

- Flags: `--framework`, `--tags`, `--models`, `--sort`
  (`downloads`|`trending`|`newest`, default trending), `--limit`, `--registry`.
- Renders a table: name, version, author, framework, models, trust, downloads.

## `agent runtime`

- Detects python3, node, docker, ollama, uv, git and prints a status table.

## `agent status`

- Snapshot of the local machine + agent state: host (OS, arch, CPU/memory,
  uptime), Docker server version, registry URL, installed OpenAgentHub agents,
  detected third-party agents, and containers.
- Third-party detection (OpenClaw, Hermes, ...) matches processes, config
  files/dirs, and listening ports against a pluggable catalog
  (`runtime/src/system/catalog.ts`).
- Flags: `--json` (machine-readable snapshot), `--all` (include non-default
  containers in the output).

## `agent ps`

- Lists Docker containers. By default only OpenAgentHub's own (`openagenthub/*`
  image); `--all` shows every container with a `docker ps`-style command.
- Flags: `--json`.

## Error convention

User-facing failures use `this.error(msg, { exit: 1 })`; genuine internal
errors may exit 2 (oclif default). The e2e script and CI rely on exit codes.
