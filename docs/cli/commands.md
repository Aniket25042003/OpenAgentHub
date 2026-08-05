# CLI — Commands reference

Per-command behavior. Flags shown are the ones that matter; run
`openagenthub <cmd> --help` for the full list.

## `openagenthub init ns/name`

- Flags: `--dir`, `--python`, `--node`, `--force`.
- Scaffolds `agent.yaml` + `app.py` (python) or `index.js` (node) +
  `README.md` + `.gitignore` into `./<name>` (or `--dir`).
- Manifest template: `manifestVersion: 1`, `name: ns/name`, `version: 0.1.0`,
  author = current OS username, `runtime.language`, `models.supported` list,
  a `cli` interface, empty permissions/dependencies, `tags: [agent]`.
- Refuses to overwrite existing files without `--force`.

## `openagenthub validate [dir]`

- Flags: `--json`.
- Loads + validates the manifest, runs `checkAgentRequirements` against the
  detected environment (python/node versions, docker if `sandbox: container`).
- Text output: `manifest valid: ns/name@version (path)` then per-requirement
  `ok`/`warn` lines; exits 1 if requirements are unsatisfied.
- `--json` emits `{ valid, manifestPath, manifest, requirements }`.

## `openagenthub login --token T [--registry URL]`

- Stores the token and registry URL in `config.json`; verifies with
  `GET /api/v1/me`. If unreachable, stores anyway and warns.
- `--registry` defaults to `https://registry.openagenthub.dev`.

## `openagenthub publish [dir]`

- Flags: `--registry`, `--public-only`.
- Loads/creates the signing key at `$AGENT_HOME/keys/id_ed25519` (+ `.pub`),
  runs `packAgent` (excludes AppleDouble `._*`, sets `COPYFILE_DISABLE=1`).
- Requires `config.token` (from `openagenthub login`), calls `me()`,
  `uploadPublicKey(publicKey)`, then `publish(...)` and `triggerScan(...)`.
- Output includes archive path, sha256, publisher key id, and
  `published ns/name@version` + `security scan queued`.

## `openagenthub install ns/name[@version]`

- Flags: `--file <archive.ahb>`, `--dir <path>` (dev mode), `--registry`,
  `--yes`, `--no-permissions`, `--force`.
- Registry install: resolve version (`latest` alias) → `downloadArchive` →
  `verifySignatureFileStrict` → strict `unpackAgent` → record in config.
  Prints trust + source; warns "will run in a container sandbox" for
  unknown/untrusted, or "running without sandbox isolation" for local.
- Prompts for each declared permission unless `--yes`/`--no-permissions`.
- Stores `signature.sig.json` + `archive.ahb` in the installed dir (used by
  `openagenthub verify`).
- **Reinstall guard**: installing an already-present exact version fails with
  a `--force` hint; `--force` reinstalls over it.

## `openagenthub update ns/name`

- Resolves `latest` on the server (highest semver, not newest publish) and
  installs that version; prints `latest version of ns/name: X.Y.Z`.
- Flags: `--registry`, `--yes`. Always overwrites the target version (force).

## `openagenthub list`

- Prints installed agents (name, version, author, trust, installed date) plus
  their granted permissions. Reads `config.json` `installed` + `permissions`.

## `openagenthub uninstall ns/name[@version]`

- Removes the installed directory, drops `installed`/`permissions` records,
  and deletes the agent's vault secrets.
- Without `@version`: removes the only installed version; refuses when
  multiple versions are installed (requires `@version` to be explicit).

## `openagenthub run ns/name[@version]`

- Flags: `--model` (e.g. `deepseek` or `openai:gpt-4o`), `--interface`
  (`cli`|`mcp`|`http`, default cli), `--input JSON`, `--interactive`,
  `--timeout ms` (default 120_000), `--agent-home`, `--allow-secrets`.
- Requires the agent to be installed (suggests `openagenthub install ...`).
- With no `@version`, resolves to the **highest installed version** when
  several are present (a note names the version being run).
- Reads **piped stdin** when `--input` absent and stdin isn't a TTY.
- Constructs `AgentRuntime(vault)`, calls `runAgent` with the *effective*
  permission set (saved ∩ manifest — tampered saved grants refuse to start),
  the installed trust level, and the model flag.
- **Revocation check first**: with a registry URL configured, pulls the public
  revocation feed; a matching `rejected`/`revoked`/`flagged` version refuses to
  run; a stale/failed feed refresh warns and forces container isolation rather
  than process trust.
- **Secrets**: vault-stored secrets matching `manifest.secrets` are prompted
  one-by-one unless `--allow-secrets` is set; un-granted secrets are skipped
  with a warning; non-TTY runs skip prompting.
- Logs `sandbox: <mode> (<reason>)` and the exposed secrets, writes
  stdout/stderr, exits with the agent's exit code. `--interactive` wires the
  terminal to the child (used for MCP stdio).

## `openagenthub sandbox show ns/name[@version]`

- Prints the effective sandbox decision for the installed agent: trust level,
  review status + freshness, manifest preference, any digest-bound override
  (`container`/`process`, digest, when it was set), and the final mode with the
  reason.

## `openagenthub sandbox set ns/name --sandbox container|process [--acknowledge-risk]`

- Sets a **local override** for how the openagenthub runs. Overrides are
  digest-bound: they record the installed archive's sha256 and silently
  expire (fall back to container isolation) if the agent is reinstalled to a
  different digest.
- `process` is only accepted for **trusted/local** agents and requires
  `--acknowledge-risk`; container overrides are always allowed.
- The override is stored in `config.json` (`sandboxOverrides`), not in the
  manifest.

## `openagenthub sandbox reset ns/name`

- Removes the local sandbox override; the manifest preference and trust rules
  apply again.

## `openagenthub verify ns/name[@version]`

- Loads the installed manifest, then `verifySignatureFileStrict` on the stored
  `archive.ahb` + `signature.sig.json`.
- Dev installs (no signature file) → warning; manifest still checked.
- Success prints `signature valid (publisher key <id>)`, sha256, integrity ok.

## `openagenthub env ns/name[@version]`

- Flags: `--delete KEY`, `--reveal KEY`, `--passphrase`.
- With no extra args: lists secret names for the agent.
- `openagenthub env ns/name KEY=VALUE ...` stores (encrypted, merged) — names must
  match `^[A-Z][A-Z0-9_]*$`.
- `--reveal` prints a value (use with care); `--delete` removes one.

## `openagenthub search [query]`

- Flags: `--framework`, `--tags`, `--models`, `--sort`
  (`downloads`|`trending`|`newest`, default trending), `--limit`, `--registry`.
- Renders a table: name, version, author, framework, models, trust, downloads.

## `openagenthub runtime`

- Detects python3, node, docker, ollama, uv, git and prints a status table.

## `openagenthub status`

- Snapshot of the local machine + agent state: host (OS, arch, CPU/memory,
  uptime), Docker server version, registry URL, installed OpenAgentHub agents,
  detected third-party agents, and containers.
- Third-party detection (OpenClaw, Hermes, ...) matches processes, config
  files/dirs, and listening ports against a pluggable catalog
  (`runtime/src/system/catalog.ts`).
- Flags: `--json` (machine-readable snapshot), `--all` (include non-default
  containers in the output).

## `openagenthub ps`

- Lists Docker containers. By default only OpenAgentHub's own sandbox containers
  (identified by their `oah-deps-*` dependency volume); `--all` shows every
  container on the machine with a `docker ps`-style command.
- Flags: `--json`.

## Error convention

User-facing failures use `this.error(msg, { exit: 1 })`; genuine internal
errors may exit 2 (oclif default). The e2e script and CI rely on exit codes.
