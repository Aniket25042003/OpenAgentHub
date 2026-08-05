# CLI — `openagenthub`

`@openagenthub/cli` — the oclif-based command-line client. Primary bin name:
`openagenthub`; `agent` remains a one-release compatibility alias
(`cli/bin/run.js`). It imports the SDK for pack/verify and the runtime engine
for execution.

The `agent` alias is deprecated and will be removed after the next major
release (see the deprecation timeline in `AGENTS.md`); docs and scripts use
`openagenthub`.

## Single-package distribution

`@openagenthub/cli` is published as one npm artifact that ships the CLI and
the web dashboard together. The web dashboard is built with Next.js
`output: "standalone"` and copied into `cli/dashboard/` by
`scripts/package.mjs`, which then runs `npm pack` with a strict `files`
allowlist. `scripts/verify-pack.mjs` installs the tarball into a clean
temporary prefix (no workspace symlinks) and checks the CLI help, both bins,
bundling of the SDK/runtime, dashboard startup (`/health`), and uninstall
behavior.

```bash
npm run pack:all    # build TS workspaces + web, bundle dashboard, pack, verify
```

The package is version-pinned (`@openagenthub/sdk`/`runtime` at `0.1.0` are
bundled in, not installed as dependencies) and has a size budget reported in
CI: 80 MiB soft / 120 MiB hard.

## Commands

| Command | Purpose |
| --- | --- |
| `openagenthub init ns/name` | Scaffold a new agent project (manifest + entrypoint template) |
| `openagenthub validate [dir]` | Validate the manifest + check local runtime requirements |
| `openagenthub login --token T` | Store a registry token in config |
| `openagenthub publish [dir]` | Pack, sign and publish to the registry |
| `openagenthub install ns/name` | Install from registry, `.ahb` file, or local dir |
| `openagenthub update ns/name` | Install the latest published version |
| `openagenthub list` | List installed agents + granted permissions |
| `openagenthub uninstall ns/name` | Remove an installed agent (+ its vault secrets) |
| `openagenthub run ns/name` | Run an installed agent (CLI/MCP/HTTP interface) |
| `openagenthub verify ns/name` | Verify signature + integrity of an installed agent |
| `openagenthub env ns/name` | Manage encrypted vault secrets |
| `openagenthub search [query]` | Search the registry |
| `openagenthub runtime` | Detect local runtimes/tooling |
| `openagenthub status` | System + agent diagnostics: host, docker, registry, installed agents, detected third-party agents (`--json`, `--all`) |
| `openagenthub ps` | List Docker containers (`--all` for every container, default OpenAgentHub's own sandbox containers) |

Run `openagenthub --help` / `openagenthub <cmd> --help` for flags. See
[commands.md](commands.md) for details.

## Structure

```
cli/src/
├── commands/            one file per command (oclif convention)
│   ├── init.ts, validate.ts, login.ts, publish.ts, install.ts,
│   ├── update.ts, list.ts, uninstall.ts, run.ts, verify.ts,
│   └── env.ts, search.ts, runtime.ts, status.ts, ps.ts
└── lib/
    ├── installer.ts     install/uninstall logic (resolve, verify, unpack, record)
    ├── print.ts         table printer
    └── prompt.ts        confirmAll() interactive prompts
```

## Key behaviors

- **Error exit codes**: `this.error(msg)` exits **2** by default (oclif). All
  user-facing failures use `{ exit: 1 }` — the e2e script and CI rely on this.
- **stdin piping**: `openagenthub run ns/name` forwards piped stdin to the agent when
  `--input` is absent and stdin is not a TTY (`run.ts`). Regression-tested.
- **Permissions**: install prompts for each requested permission unless
  `--yes` / `--no-permissions`. Grants are persisted in `config.json`
  (`permissions`).
- **Secrets**: `openagenthub env ns/name KEY=VALUE` writes to the machine-bound vault;
  values are never echoed (listing only shows names).
- **Config**: stored in `config.json` (see
  [runtime/config.md](../runtime/config.md)) — `registryUrl`, `token`,
  `installed`, `permissions`.

## Tests

`node --test "test/*.test.ts"` from `cli/` (quoted glob). 14 tests, including
the stdin-piping regression test. Tests run against a temp `AGENT_HOME`.
