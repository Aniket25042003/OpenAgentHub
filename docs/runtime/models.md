# Runtime — Models

`src/models.ts`

Resolves a model *name* into a provider, concrete model id, base URL, and API
key, and builds the agent's model environment.

## Providers

| Provider | Key env var | Default model | Base URL |
| --- | --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | `https://api.openai.com/v1` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | `https://api.anthropic.com` |
| `google` | `GOOGLE_API_KEY` | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` | `https://api.deepseek.com` |
| `ollama` | — (no key) | `llama3.1` | `http://localhost:11434/v1` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` | `https://api.mistral.ai/v1` |
| `xai` | `XAI_API_KEY` | `grok-2-latest` | `https://api.x.ai/v1` |
| `groq` | `GROQ_API_KEY` | `llama-3.1-8b-instant` | `https://api.groq.com/openai/v1` |
| `local` | — (no key) | `local-model` | `http://localhost:8000/v1` |
| `custom` | — | `custom-model` | — |

This mirrors the schema's `models.supported` enum
(`openai, anthropic, google, deepseek, ollama, mistral, xai, groq, local, custom`).

## `pickModel(manifest, requested, vault, agentKey)`

- If `requested` (from `--model`): split on `:` into `provider` and optional
  `model` (e.g. `openai:gpt-4o`). The provider **must** be in
  `manifest.models.supported` → `ModelError` otherwise.
- Otherwise: pick the first supported provider that has a key in the vault
  (`PROVIDERS[p].keyEnv`), falling back to `supported[0]`.
- API key comes from the vault (`vault.get(agentKey)[keyEnv]`).
- If a requested keyed provider has no key (and isn't ollama/local), throws
  `ModelError` with a hint like:
  `agent env ns/name OPENAI_API_KEY=...`.

## `buildAgentEnv(model, agentName, agentVersion)`

Emits:

```
AGENT_NAME, AGENT_VERSION, AGENT_MODEL_PROVIDER, AGENT_MODEL_NAME,
AGENT_BASE_URL (when set), AGENT_API_KEY (when set),
<PROVIDER_KEY_ENV> (e.g. OPENAI_API_KEY, when key present),
AGENT_MODEL_KEY_MISSING (<key env>)  when a keyed provider is missing its key
```

The agent gets both the normalized `AGENT_MODEL_*` vars and the provider's
native key env var, so it can call the provider directly.
