import type { UsageStore, UsageProvider, LimitRow } from "../usage.js";
import { SecretsVault } from "../secrets.js";
import { experimentalEnabled } from "./detect.js";
import { num, isUsageObject, type LimitObservation } from "./types.js";

export const LIVE_TIMEOUT_MS = 5_000;
const INTEGRATION_VAULT_KEY = "__integrations__";

export const LIVE_ENDPOINTS: Record<string, string[]> = {
  openai: ["https://api.openai.com/v1/organization/usage/completions (official; OpenAI API key)"],
  anthropic: ["https://api.anthropic.com/api/usage (unofficial/experimental; Anthropic API key)"],
};

type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function integrationKey(vault: SecretsVault, env: string): string | undefined {
  return vault.get(INTEGRATION_VAULT_KEY)[env] ?? process.env[env];
}

export function storeIntegrationKey(vault: SecretsVault, env: string, value: string): void {
  const current = vault.get(INTEGRATION_VAULT_KEY);
  current[env] = value;
  vault.set(INTEGRATION_VAULT_KEY, current);
}

export function clearIntegrationKey(vault: SecretsVault, env: string): void {
  const current = vault.get(INTEGRATION_VAULT_KEY);
  delete current[env];
  vault.set(INTEGRATION_VAULT_KEY, current);
}

export async function fetchLiveLimits(
  provider: UsageProvider,
  opts: { apiKey?: string; fetchFn?: FetchFn; vault?: SecretsVault },
): Promise<LimitObservation[]> {
  if (!opts.apiKey) return [];
  const fetchFn = opts.fetchFn ?? defaultFetch;
  if (provider === "codex") {
    const obs = await fetchOpenAiUsage(opts.apiKey, fetchFn);
    return obs.map((o) => ({ ...o, provider }));
  }
  if (provider === "claude") {
    if (!experimentalEnabled()) return [];
    const obs = await fetchAnthropicUsage(opts.apiKey, fetchFn);
    return obs.map((o) => ({ ...o, provider }));
  }
  return [];
}

async function fetchOpenAiUsage(apiKey: string, fetchFn: FetchFn): Promise<Array<Omit<LimitObservation, "provider">>> {
  const startTime = Math.floor(Date.now() / 1000) - 86_400;
  const url = `https://api.openai.com/v1/organization/usage/completions?start_time=${startTime}&bucket_width=1d`;
  let res;
  try {
    res = await fetchFn(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return [];
  }
  if (!isUsageObject(body)) return [];
  const data = body.data;
  if (!Array.isArray(data)) return [];
  const out: Array<Omit<LimitObservation, "provider">> = [];
  for (const bucket of data) {
    if (!isUsageObject(bucket)) continue;
    const start = num(bucket.start_time);
    if (start === undefined) continue;
    const results = bucket.results;
    if (!Array.isArray(results)) continue;
    let input = 0;
    let output = 0;
    let requests = 0;
    for (const r of results) {
      if (!isUsageObject(r)) continue;
      input += num(r.input_tokens) ?? 0;
      output += num(r.output_tokens) ?? 0;
      requests += num(r.num_model_requests) ?? 0;
    }
    if (input === 0 && output === 0 && requests === 0) continue;
    const day = new Date(start * 1000).toISOString().slice(0, 10);
    out.push({
      window: day,
      units: "tokens",
      creditsUsed: input,
      creditsTotal: input + output,
      source: "live",
    });
  }
  return out;
}

async function fetchAnthropicUsage(apiKey: string, fetchFn: FetchFn): Promise<Array<Omit<LimitObservation, "provider">>> {
  const url = "https://api.anthropic.com/api/usage";
  let res;
  try {
    res = await fetchFn(url, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return [];
  }
  if (!isUsageObject(body)) return [];
  const used = num(body.used);
  const given = num(body.given);
  if (used === undefined && given === undefined) return [];
  const obs: Omit<LimitObservation, "provider"> = {
    window: "until-period-end",
    plan: typeof body.plan === "string" ? body.plan : undefined,
    units: "tokens",
    creditsUsed: used,
    creditsTotal: given,
    source: "live",
  };
  const reset = typeof body.period_end === "string" ? body.period_end : typeof body.reset_at === "string" ? body.reset_at : undefined;
  if (reset) obs.resetAt = reset;
  if (used !== undefined && given !== undefined && given > 0) obs.usedPercent = Math.round((used / given) * 1000) / 10;
  return [obs];
}

export async function defaultFetch(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<{ ok: boolean; json(): Promise<unknown> }> {
  const res = await fetch(url, init as RequestInit);
  return { ok: res.ok, json: () => res.json() };
}
