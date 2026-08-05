# aniketpatel/pr-reviewer

A reference OpenAgentHub agent that reviews a GitHub pull request for bugs,
security issues and style problems.

## Usage

```bash
# install (trusted for local development)
openagenthub install aniketpatel/pr-reviewer --dir . --yes

# set the secrets it needs
openagenthub env aniketpatel/pr-reviewer GITHUB_TOKEN=<token>
openagenthub env aniketpatel/pr-reviewer OPENAI_API_KEY=<token>   # optional

# review a PR
echo '{"repo": "owner/repo", "pr": 12}' | openagenthub run aniketpatel/pr-reviewer --model openai
```

Without an LLM API key the agent falls back to static heuristics
(hardcoded secrets, eval/exec, SQL injection patterns, TODOs, debug prints).

## Manifest highlights

- `permissions: [network]` — the agent must reach the GitHub API
- `secrets` — declares `GITHUB_TOKEN`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`
- `models.supported` — openai, anthropic, deepseek, ollama, local
- `interfaces.cli` — JSON-in / JSON-out over stdin/stdout
