# Runtime — Process sandbox

`src/sandbox/process.ts`

The fast path for **trusted** and **local** agents. Direct child-process
execution with a few guards. Not a security boundary — it exists for speed and
zero-dependency convenience.

## Constructor guard

```ts
constructor(spec: SandboxSpec, trustLevel: "trusted" | "local")
```

Throws if given `untrusted`/`unknown` — the process path is **never** used for
unverified code. The runtime (`runtime.ts`) enforces the same invariant before
constructing it.

## Command splitting

`splitCommand(command)` tokenizes on whitespace and **rejects shell
metacharacters** in any token:

```
[;&|<>`$()]
```

So `python app.py` runs, but `python app.py; rm -rf /` throws. `spawn` is
called with the raw argv, never through a shell.

## prepare()

Installs declared dependencies into the agent dir before running:

- `runtime.language === "python"` + `dependencies.pip` → create `agentDir/.venv`
  and `pip install`.
- `runtime.language === "node"` + `dependencies.npm` → `npm install` in
  `agentDir`.
- **Requires `network` granted** — throws otherwise
  ("agent declares pip dependencies but network permission was not granted").
- Cached: `prepare()` runs once per sandbox instance (the `.venv` persists
  between runs; `cleanup()` is a no-op).

## run(opts)

```ts
run({ command, input?, timeoutMs? }): Promise<RunResult>
```

- `spawn(cmd, args, { cwd: agentDir, env: {...process.env, ...spec.env} })`.
- Writes `input` (if any) to stdin, then ends stdin — agents that read to EOF
  never hang.
- Collects stdout/stderr; on `timeoutMs` sends `SIGKILL` and sets
  `timedOut: true`.
- Resolves on `close` with `{ exitCode, stdout, stderr, timedOut }`.

## runInteractive(opts)

For MCP stdio sessions (`--interface mcp --interactive`): `spawn` with
`stdio: "inherit"`, resolves with the child's exit code.

## Gotchas

- The metacharacter rejection lives here, not in the CLI — any caller gets it
  for free.
- `PYTHON_BIN` env var overrides the interpreter used for prepare/run.
