#!/usr/bin/env python3
"""Reference OpenAgentHub agent: GitHub PR reviewer.

Input (stdin JSON):  {"repo": "owner/repo", "pr": 12}
Output (stdout JSON):
    {"ok": true, "summary": "...", "findings": [{"severity","file","line","message"}]}

Works with only the Python standard library so it runs in the container
sandbox without any dependency install. Uses an LLM when an API key is
available via the agent environment (AGENT_API_KEY + AGENT_BASE_URL), and
falls back to static heuristics otherwise.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

GITHUB_API = "https://api.github.com"


def read_input() -> dict:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        data = {}
    return data


def fetch(url: str, token: str | None = None) -> dict | list:
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "openagenthub-pr-reviewer",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        return {"error": f"HTTP {exc.code}: {body[:300]}"}


def build_diff_text(files) -> str:
    lines = []
    for f in files:
        if isinstance(f, dict) and "filename" in f:
            lines.append(f"=== {f.get('filename')} (+{f.get('additions')} -{f.get('deletions')}) ===")
            lines.append(f.get("patch", "") or "(binary file, no patch)")
    return "\n".join(lines)


# Static heuristics: fire-and-forget checks that always run (and are the only
# signal when no LLM key is configured).
HEURISTICS = [
    (re.compile(r"\bpassword\s*=\s*['\"][^'\"]+['\"]"), "high", "hardcoded password literal"),
    (re.compile(r"\b(api[_-]?key|secret|token)\s*=\s*['\"][^'\"]+['\"]", re.I), "high", "hardcoded secret"),
    (re.compile(r"\beval\(|exec\(|child_process\.exec|os\.system\("), "high", "dynamic code execution"),
    (re.compile(r"\bSELECT\b.*\bWHERE\b.*(['\"])1\1\s*=\s*\1?1\1?|\.format\(\s*['\"].*%s", re.I | re.S), "high", "possible SQL injection"),
    (re.compile(r"\bTODO\b|\bFIXME\b|\bHACK\b"), "low", "leftover TODO/FIXME marker"),
    (re.compile(r"console\.log\(|print\(\s*['\"]"), "low", "debug print left in code"),
    (re.compile(r"try:\s*\n\s*pass|except\s*:?\s*\n\s*pass"), "medium", "empty exception handler"),
    (re.compile(r"assert\s+False"), "high", "assert False (possibly disabled assert)"),
]


def heuristic_findings(diff_text: str) -> list[dict]:
    findings = []
    for line_no, line in enumerate(diff_text.splitlines(), start=1):
        if not line.startswith("+"):
            continue
        for pattern, severity, message in HEURISTICS:
            if pattern.search(line):
                findings.append({
                    "severity": severity,
                    "file": line.split("\t")[0],
                    "line": line_no,
                    "message": message,
                })
    return findings


def llm_review(diff_text: str, files) -> dict:
    base_url = os.environ.get("AGENT_BASE_URL", "").rstrip("/")
    api_key = os.environ.get("AGENT_API_KEY", "")
    model = os.environ.get("AGENT_MODEL_NAME", "gpt-4o-mini")
    if not api_key or not base_url:
        return {}
    prompt = (
        "You are a senior code reviewer. Review the following GitHub pull request diff.\n"
        "Respond with ONLY JSON of shape {\"summary\": str, \"findings\": [{\"severity\": \"high|medium|low\", "
        "\"file\": str, \"line\": int, \"message\": str}]}.\n"
        f"Diff:\n{diff_text[:12000]}"
    )
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 1500,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.load(resp)
        text = body["choices"][0]["message"]["content"]
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1])
    except Exception as exc:  # noqa: BLE001 - fall back to heuristics on any LLM failure
        return {"llm_error": str(exc)}


def main() -> None:
    data = read_input()
    repo = data.get("repo") or os.environ.get("AGENT_INPUT_REPO")
    pr = data.get("pr")
    if not repo or pr is None:
        print(json.dumps({"ok": False, "error": "usage: pass {\"repo\": \"owner/repo\", \"pr\": <number>} on stdin"}))
        sys.exit(1)

    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print(json.dumps({"ok": False, "error": "GITHUB_TOKEN is not set (add it with: agent env aniketpatel/pr-reviewer GITHUB_TOKEN=...)"}))
        sys.exit(2)

    pr_data = fetch(f"{GITHUB_API}/repos/{repo}/pulls/{pr}", token)
    if isinstance(pr_data, dict) and pr_data.get("error"):
        print(json.dumps({"ok": False, "error": pr_data["error"]}))
        sys.exit(3)
    files = fetch(f"{GITHUB_API}/repos/{repo}/pulls/{pr}/files", token)
    if isinstance(files, dict) and files.get("error"):
        print(json.dumps({"ok": False, "error": files["error"]}))
        sys.exit(3)

    diff_text = build_diff_text(files if isinstance(files, list) else [])
    findings = heuristic_findings(diff_text)
    llm = llm_review(diff_text, files)
    if llm and "summary" in llm:
        findings = llm.get("findings", findings) or findings
        summary = llm["summary"]
        model_used = os.environ.get("AGENT_MODEL_NAME", "")
    else:
        summary = (
            f"Reviewed PR #{pr} of {repo} using static heuristics "
            f"({len(findings)} finding(s)). Configure an LLM API key for deeper analysis."
        )
        model_used = "heuristics"

    print(json.dumps({
        "ok": True,
        "repo": repo,
        "pr": pr,
        "model": model_used,
        "summary": summary,
        "findings": findings,
    }))


if __name__ == "__main__":
    main()
