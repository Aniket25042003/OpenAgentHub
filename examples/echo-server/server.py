#!/usr/bin/env python3
"""HTTP interface for the echo agent. POST JSON to /echo.

Example:
    curl -s -X POST http://localhost:8080/echo -H 'Content-Type: application/json' -d '{"hello":"world"}'
"""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") != "/echo":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_error(400, "invalid JSON body")
            return
        body = json.dumps({"ok": True, "echo": payload}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # noqa: A003
        sys.stderr.write(f"{self.address_string()} - {fmt % args}\n")


if __name__ == "__main__":
    import os
    import sys

    port = int(os.environ.get("AGENT_HTTP_PORT", "8080"))
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
