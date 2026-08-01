import type { Manifest, ModelProvider } from "@openagenthub/sdk";
import { SecretsVault } from "./secrets.js";

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

const PROVIDERS: Record<ModelProvider, { model: string; baseUrl?: string; keyEnv?: string }> = {
  openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  anthropic: { model: "claude-sonnet-4-20250514", baseUrl: "https://api.anthropic.com", keyEnv: "ANTHROPIC_API_KEY" },
  google: { model: "gemini-2.0-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", keyEnv: "GOOGLE_API_KEY" },
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY" },
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434/v1" },
  mistral: { model: "mistral-small-latest", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY" },
  xai: { model: "grok-2-latest", baseUrl: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY" },
  groq: { model: "llama-3.1-8b-instant", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  local: { model: "local-model", baseUrl: "http://localhost:8000/v1" },
  custom: { model: "custom-model" },
};

export class ModelError extends Error {}

export function pickModel(
  manifest: Manifest,
  requested: string | undefined,
  vault: SecretsVault,
  agentKey: string,
): ModelConfig {
  const supported = manifest.models.supported;
  const secrets = vault.get(agentKey);

  let provider: ModelProvider;
  let overrideModel: string | undefined;

  if (requested) {
    const [reqProvider, reqModel] = requested.split(":");
    if (!supported.includes(reqProvider as ModelProvider)) {
      throw new ModelError(
        `model provider '${reqProvider}' is not in manifest.models.supported (${supported.join(", ")})`,
      );
    }
    provider = reqProvider as ModelProvider;
    overrideModel = reqModel;
  } else {
    const withKey = supported.find((p) => !PROVIDERS[p].keyEnv || secrets[PROVIDERS[p].keyEnv!]);
    provider = withKey ?? supported[0];
  }

  const cfg = PROVIDERS[provider];
  const model = overrideModel ?? cfg.model;
  const apiKey = cfg.keyEnv ? secrets[cfg.keyEnv] : undefined;

  if (requested && cfg.keyEnv && !apiKey && provider !== "ollama" && provider !== "local") {
    throw new ModelError(`no API key for provider '${provider}'. Set it with: agent env ${agentKey} ${cfg.keyEnv}=...`);
  }

  return { provider, model, baseUrl: cfg.baseUrl, apiKey };
}

export function buildAgentEnv(model: ModelConfig, agentName: string, agentVersion: string): Record<string, string> {
  const env: Record<string, string> = {
    AGENT_NAME: agentName,
    AGENT_VERSION: agentVersion,
    AGENT_MODEL_PROVIDER: model.provider,
    AGENT_MODEL_NAME: model.model,
  };
  if (model.baseUrl) env.AGENT_BASE_URL = model.baseUrl;
  if (model.apiKey) env.AGENT_API_KEY = model.apiKey;
  if (PROVIDERS[model.provider].keyEnv && model.apiKey) {
    env[PROVIDERS[model.provider].keyEnv!] = model.apiKey;
  }
  const keyEnv = PROVIDERS[model.provider].keyEnv;
  if (keyEnv && !model.apiKey && model.provider !== "ollama" && model.provider !== "local") {
    env.AGENT_MODEL_KEY_MISSING = keyEnv;
  }
  return env;
}
