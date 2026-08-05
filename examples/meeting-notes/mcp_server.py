#!/usr/bin/env python3
"""Reference OpenAgentHub agent: MCP server (stdio transport).

Implements a minimal, dependency-free MCP server speaking the stdio
newline-delimited JSON-RPC protocol:

    ->  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
    <-  {"jsonrpc":"2.0","id":1,"result":{...}}
    ->  {"jsonrpc":"2.0","method":"notifications/initialized"}
    ->  {"jsonrpc":"2.0","id":2,"method":"tools/list"}
    <-  {"jsonrpc":"2.0","id":2,"result":{"tools":[...]}}
    ->  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"summarize_transcript","arguments":{...}}}
    <-  {"jsonrpc":"2.0","id":3,"result":{"content":[...]}}

Run with:  openagenthub run aniketpatel/meeting-notes --interface mcp --interactive
"""

import json
import re
import sys

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "meeting-notes"
SERVER_VERSION = "1.0.0"

TOOL = {
    "name": "summarize_transcript",
    "description": "Turn a meeting transcript into structured minutes.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "transcript": {"type": "string", "description": "raw meeting transcript"},
        },
        "required": ["transcript"],
    },
}

ACTION_ITEMS = re.compile(
    r"(?i)\b(everyone will|i will|we will|action item|todo|to do|follow up|will send|will create|will fix)\b[^.\n]*"
)
DECISION = re.compile(r"(?i)\b(we decided|we agree(?:d)?|decision|let'?s go with|final call|decided to)\b[^.\n]*")
QUESTION = re.compile(r"\b(what|how|when|who|where|should we|can we|does anyone know)\b[^?]*\?")


def summarize_transcript(transcript: str) -> dict:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", transcript) if s.strip()]
    decisions = []
    actions = []
    questions = []
    for s in sentences:
        if DECISION.search(s):
            decisions.append(s)
        if ACTION_ITEMS.search(s):
            actions.append(s)
        if QUESTION.search(s):
            questions.append(s)
    return {
        "speakers": len({w for w in re.findall(r"(?m)^\s*([A-Z][A-Za-z .-]{2,20})\s*:", transcript)}),
        "topics": [s for s in sentences if len(s) > 80][:5],
        "decisions": decisions,
        "action_items": actions,
        "open_questions": questions,
    }


def handle_call(name: str, arguments: dict) -> dict:
    if name != "summarize_transcript":
        return {"content": [{"type": "text", "text": f"unknown tool: {name}"}], "isError": True}
    transcript = (arguments or {}).get("transcript", "")
    if not transcript:
        return {"content": [{"type": "text", "text": "missing required argument: transcript"}], "isError": True}
    minutes = summarize_transcript(transcript)
    return {
        "content": [{"type": "text", "text": json.dumps(minutes, indent=2)}],
        "isError": False,
    }


def main() -> None:
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = msg.get("method")

        if method == "initialize":
            respond(msg, {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            })
        elif method == "notifications/initialized":
            continue
        elif method == "ping":
            respond(msg, {})
        elif method == "tools/list":
            respond(msg, {"tools": [TOOL]})
        elif method == "tools/call":
            respond(msg, handle_call(msg.get("params", {}).get("name", ""), msg.get("params", {}).get("arguments", {})))
        elif method == "shutdown":
            respond(msg, {})
            sys.exit(0)


def respond(msg: dict, result) -> None:
    if "id" not in msg:
        return
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
