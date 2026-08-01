# Execution

`runtime/src/runtime.ts` — `AgentRuntime.runAgent()`. This is what actually
runs an installed agent.

## Steps

```ts
runAgent(opts: {
  agentDir: string;         // installed agent directory
  manifest: Manifest;
  agentKey: string;         // "namespace/name@version"
  interfaceName?: "cli" | "mcp" | "http";
  input?: string;           // JSON for cli
  granted: Permission[];    // granted permission names only
  trustLevel: "trusted" | "untrusted" | "unknown" | "local";
  model?: string;           // "provider" or "provider:model"
  extraSecrets?: Record<string, string>;
  timeoutMs?: number;
  interactive?: boolean;
}): Promise<RunAgentResult>
```

`RunAgentResult = { result: RunResult, interfaceName, sandbox, model }`.

1. **Interface**: default `cli`. `mcp` requires `interfaces.mcp.entrypoint`;
   `http` requires `interfaces.http.endpoint`.
   - **HTTP shortcut**: the local runtime does not host HTTP; it returns
     `{ exitCode: 0, stdout: "remote agent endpoint: <ep>" }` with
     `sandbox: "none"`. Hosting is the CLI's job.
2. **Model** (`pickModel`): `--model` (or `provider:model`) must be in
   `manifest.models.supported`; otherwise picks the first supported provider
   with a vault key. Builds env with `buildAgentEnv`.
3. **Env**: model vars → vault secrets → `extraSecrets` → `AGENT_TRUST`,
   `AGENT_HOME` (set to the agent dir), `AGENT_GRANTED_PERMISSIONS`.
4. **Sandbox**: `detectRuntime()` + `decideSandbox(manifest, detected,
   trustLevel)` → `mode: "container" | "isolated-process"`. Container for
   unknown/untrusted; `ProcessSandbox` only for trusted/local (guarded).
5. **Command**: `interfaces.cli.command` or `interfaces.mcp.entrypoint`.
6. **Run**: `interactive` → `sandbox.runInteractive` (stdio inherit, exit
   code); otherwise `sandbox.run({ command, input, timeoutMs })`.

## RunResult

```ts
interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;      // set when timeoutMs killed the process/container
}
```

## Env injection order (last wins)

1. `buildAgentEnv(model, manifest.name, manifest.version)` —
   `AGENT_NAME`, `AGENT_VERSION`, `AGENT_MODEL_PROVIDER`, `AGENT_MODEL_NAME`,
   `AGENT_BASE_URL`, `AGENT_API_KEY`, provider key env (`OPENAI_API_KEY`, ...).
2. Vault secrets for `agentKey`.
3. `opts.extraSecrets`.
4. `AGENT_TRUST`, `AGENT_HOME`, `AGENT_GRANTED_PERMISSIONS`.

## Timeouts

`timeoutMs` (CLI flag `--timeout`, default 120_000) is enforced by the
sandbox: the process sandbox `SIGKILL`s the child; the container sandbox kills
the container. On timeout, `timedOut: true` and partial stdout/stderr are
returned.

## CLI wiring (`cli/src/commands/run.ts`)

- Resolves the installed record from `config.installed`, loads the manifest,
  reads granted permissions, opens the vault, constructs
  `new AgentRuntime(vault)`, and calls `runAgent`.
- Piped stdin is read into `input` when `--input` is absent and stdin is not a
  TTY. `--interactive` wires the terminal for MCP stdio servers.
