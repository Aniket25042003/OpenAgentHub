# CLI — `agent`

`@openagenthub/cli` — the oclif-based command-line client. Bin name: `agent`
(`cli/bin/run.js`). It imports the SDK for pack/verify and the runtime engine
for execution.

## Commands

| Command | Purpose |
| --- | --- |
| `agent init ns/name` | Scaffold a new agent project (manifest + entrypoint template) |
| `agent validate [dir]` | Validate the manifest + check local runtime requirements |
| `agent login --token T` | Store a registry token in config |
| `agent publish [dir]` | Pack, sign and publish to the registry |
| `agent install ns/name` | Install from registry, `.ahb` file, or local dir |
| `agent update ns/name` | Install the latest published version |
| `agent list` | List installed agents + granted permissions |
| `agent uninstall ns/name` | Remove an installed agent (+ its vault secrets) |
| `agent run ns/name` | Run an installed agent (CLI/MCP/HTTP interface) |
| `agent verify ns/name` | Verify signature + integrity of an installed agent |
| `agent env ns/name` | Manage encrypted vault secrets |
| `agent search [query]` | Search the registry |
| `agent runtime` | Detect local runtimes/tooling |
| `agent status` | System + agent diagnostics: host, docker, registry, installed agents, detected third-party agents (`--json`, `--all`) |
| `agent ps` | List Docker containers (`--all` for every container, default OpenAgentHub's own) |

Run `agent --help` / `agent <cmd> --help` for flags. See
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
- **stdin piping**: `agent run ns/name` forwards piped stdin to the agent when
  `--input` is absent and stdin is not a TTY (`run.ts`). Regression-tested.
- **Permissions**: install prompts for each requested permission unless
  `--yes` / `--no-permissions`. Grants are persisted in `config.json`
  (`permissions`).
- **Secrets**: `agent env ns/name KEY=VALUE` writes to the machine-bound vault;
  values are never echoed (listing only shows names).
- **Config**: stored in `config.json` (see
  [runtime/config.md](../runtime/config.md)) — `registryUrl`, `token`,
  `installed`, `permissions`.

## Tests

`node --test "test/*.test.ts"` from `cli/` (quoted glob). 10 tests, including
the stdin-piping regression test. Tests run against a temp `AGENT_HOME`.
