# aniketpatel/meeting-notes

A reference OpenAgentHub agent that exposes a Model Context Protocol (MCP)
server over stdio with a single `summarize_transcript` tool.

## Usage

```bash
agent install aniketpatel/meeting-notes --dir . --yes
agent run aniketpatel/meeting-notes --interface mcp --interactive
```

Connect any MCP client to the spawned process. To try it in isolation:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"summarize_transcript","arguments":{"transcript":"Alice: we decided to ship on Friday. Bob: I will write the release notes."}}}' \
  | python mcp_server.py
```

## Manifest highlights

- `interfaces.mcp` — stdio transport with `entrypoint` and declared `tools`
- No `permissions`, no `secrets` — the agent is intentionally minimal
