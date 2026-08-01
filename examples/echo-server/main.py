#!/usr/bin/env python3
"""Reference OpenAgentHub agent: JSON echo.

CLI interface: reads a JSON object from stdin and echoes it back wrapped in
agent metadata (also demonstrates reading the standard agent environment).

HTTP interface: run `python server.py` and POST JSON to /echo.
"""

import json
import os
import sys


def main() -> None:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"invalid JSON input: {exc}"}))
        sys.exit(1)

    print(json.dumps({
        "ok": True,
        "echo": payload,
        "agent": {
            "name": os.environ.get("AGENT_NAME", ""),
            "version": os.environ.get("AGENT_VERSION", ""),
            "trust": os.environ.get("AGENT_TRUST", ""),
            "permissions": (os.environ.get("AGENT_GRANTED_PERMISSIONS", "") or "").split(","),
        },
    }))


if __name__ == "__main__":
    main()
