# Reference agents

`examples/` — three intentionally small, **zero-dependency** agents (Python
stdlib only) that exercise every interface and are used by tests and docs.

The rule: **prefer zero-dependency agent code** so container runs need no
dependency install step. Keep these tiny; they double as living documentation.

## `examples/echo-server/`

Minimal agent demonstrating both **CLI** and **HTTP** interfaces.

- `agent.yaml`: `cli.command: "python main.py"`, `http.endpoint:
  http://localhost:8080/echo`, `permissions: [none]`, `models.supported:
  [local]`.
- `main.py`: reads JSON from stdin, echoes it back wrapped in agent metadata
  (reads the standard agent env: `AGENT_NAME`, `AGENT_VERSION`, `AGENT_TRUST`,
  `AGENT_GRANTED_PERMISSIONS`).
- `server.py`: a tiny HTTP server (`python server.py`) that echoes POSTed JSON
  at `/echo`.
- Exercises: piped stdin → stdout JSON, interface selection (`--interface cli`
  vs `--interface http`), and reading the agent environment.

## `examples/github-pr-reviewer/`

Demonstrates **network** permission + **secrets** (`GITHUB_TOKEN`).

- `agent.yaml`: `permissions: [network]`, `secrets: [GITHUB_TOKEN,
  OPENAI_API_KEY, DEEPSEEK_API_KEY]`, cli command `python main.py`.
- `main.py`: reads `{"repo": "owner/repo", "pr": <number>}` from stdin, fetches
  the PR + files diff from the GitHub API (stdlib `urllib`), runs static
  heuristic checks (hardcoded secrets, dynamic exec, SQL injection, TODOs,
  debug prints, empty handlers, `assert False`), and — when an LLM key is
  configured via `AGENT_API_KEY`/`AGENT_BASE_URL` — calls the model provider
  for a deeper review. Output:
  `{ok, repo, pr, model, summary, findings[]}`.
- Exercises: secrets vault injection, network gating, env-based provider
  access, graceful LLM fallback.

## `examples/meeting-notes/`

Demonstrates the **MCP** interface (Model Context Protocol over stdio).

- `agent.yaml`: `mcp.entrypoint: "python mcp_server.py"`, `transport: stdio`,
  `tools: [summarize_transcript]`, `permissions: [none]`.
- `mcp_server.py`: a minimal stdlib-only MCP server implementing
  `initialize`, `tools/list`, and `tools/call` (a `summarize_transcript` tool
  that returns structured minutes: decisions, action items, open questions).
- Exercises: `agent run aniketpatel/meeting-notes --interface mcp
  --interactive`; live-tested with `initialize`/`tools/list`/`tools/call`
  during M5.

## How to test/pack them

```bash
npm run build
node cli/bin/run.js validate examples/echo-server
node cli/bin/run.js publish examples/echo-server   # needs a registry + login
```

All three validate and pack cleanly. Generated `.ahb`/`.sig.json` artifacts
are excluded by the packer's ignore list.

## Adding a new example

1. New dir `examples/<name>/` with `agent.yaml` + stdlib-only code.
2. Wire a sanity case into `test/e2e.sh` if it exercises a new interface.
3. Keep the manifest minimal but schema-valid; run `agent validate`.
