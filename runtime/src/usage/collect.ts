import type { UsageStore, UsageProvider, LimitRow } from "../usage.js";
import { collectClaude } from "./claude.js";
import { collectCodex } from "./codex.js";
import { collectOpencode } from "./opencode.js";
import { allIntegrationStatus, consent, enabled, setConsent } from "./consent.js";
import { providerDetected } from "./detect.js";
import { fetchLiveLimits } from "./live.js";
import { SecretsVault } from "../secrets.js";
import type { AdapterOutput, CollectionResult, LimitObservation, ProviderName, UsageObservation } from "./types.js";

export const COLLECT_TOTAL_BUDGET_MS = 5_000;
export const COLLECT_PER_PROVIDER_MS = 1_500;

export interface CollectOptions {
  providers?: ProviderName[];
  budgetMs?: number;
  includeLive?: boolean;
  force?: boolean;
}

export function collectProvidersSync(store: UsageStore, opts: CollectOptions = {}): CollectionResult {
  const startedAt = Date.now();
  const budget = opts.budgetMs ?? COLLECT_TOTAL_BUDGET_MS;
  const want = opts.providers ?? ["claude", "codex", "opencode"];
  const settings = (key: string) => store.getSetting(key);

  const providers: AdapterOutput[] = [];
  const limitBudget = budget / Math.max(1, want.length);
  for (const provider of want) {
    const deadlineMs = Math.max(250, Math.min(COLLECT_PER_PROVIDER_MS, limitBudget));
    if (!enabled(store, provider)) {
      providers.push({
        usage: [],
        limits: [],
        result: { provider, detected: false, status: "disabled", sourcesScanned: 0, eventsIngested: 0, eventsSkipped: 0, timeMs: 0, message: "integration disabled" },
      });
      continue;
    }
    if (!consent(store, provider, "credentials")) {
      providers.push({
        usage: [],
        limits: [],
        result: {
          provider,
          detected: providerDetected(provider),
          status: "disabled",
          sourcesScanned: 0,
          eventsIngested: 0,
          eventsSkipped: 0,
          timeMs: 0,
          message: "consent not granted — run 'openagenthub integrations enable <provider> --credentials'",
        },
      });
      continue;
    }
    const output = provider === "claude" ? collectClaude(store, deadlineMs, settings) : provider === "codex" ? collectCodex(store, deadlineMs, settings) : collectOpencode(store, deadlineMs, settings);
    providers.push(output);
  }

  const usage: UsageObservation[] = [];
  const limits: LimitObservation[] = [];
  for (const p of providers) {
    for (const u of p.usage) {
      if (store.recordExternal(u)) usage.push(u);
    }
    for (const l of p.limits) {
      store.upsertLimit({ ...l, observedAt: new Date().toISOString() });
      limits.push(l);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    providers: providers.map((p) => p.result),
    usage,
    limits,
    timeboxed: Date.now() - startedAt > budget,
  };
}

export async function collectProviders(store: UsageStore, opts: CollectOptions = {}): Promise<CollectionResult> {
  const sync = collectProvidersSync(store, opts);
  if (opts.includeLive === false) return sync;
  const want = opts.providers ?? (["claude", "codex"] as ProviderName[]);
  for (const provider of want) {
    if (!consent(store, provider, "live")) continue;
    const vault = SecretsVault.open();
    const env = provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    const apiKey = vault.get("__integrations__")[env] ?? process.env[env];
    const live = await fetchLiveLimits(provider, { apiKey, vault });
    for (const l of live) {
      store.upsertLimit({ ...l, observedAt: new Date().toISOString() });
      sync.limits.push(l);
    }
  }
  return sync;
}

export interface ProviderUsageOverview {
  provider: ProviderName;
  detected: boolean;
  events: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  costExact: number;
  costEstimated: number;
  costExactAvailable: boolean;
  costEstimatedAvailable: boolean;
  models: Array<{ model: string; events: number; tokensIn: number; tokensOut: number }>;
  lastObservedAt: string | null;
}

export function providerUsageOverview(store: UsageStore): ProviderUsageOverview[] {
  const rows = store.listExternalUsage();
  const byProvider = new Map<string, ProviderUsageOverview>();
  const modelsByProvider = new Map<string, Map<string, { model: string; events: number; tokensIn: number; tokensOut: number }>>();
  for (const row of rows) {
    const entry = byProvider.get(row.provider) ?? {
      provider: row.provider,
      detected: false,
      events: 0,
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      costExact: 0,
      costEstimated: 0,
      costExactAvailable: false,
      costEstimatedAvailable: false,
      models: [],
      lastObservedAt: null,
    };
    entry.events++;
    entry.tokensIn += row.tokensIn;
    entry.tokensOut += row.tokensOut;
    entry.cacheRead += row.cacheRead ?? 0;
    if (row.costExact !== undefined && row.costExact > 0) {
      entry.costExact += row.costExact;
      entry.costExactAvailable = true;
    }
    if (row.costEstimated !== undefined && row.costEstimated > 0) {
      entry.costEstimated += row.costEstimated;
      entry.costEstimatedAvailable = true;
    }
    if (!entry.lastObservedAt || row.occurredAt > entry.lastObservedAt) entry.lastObservedAt = row.occurredAt;
    const model = row.model ?? "unknown";
    const models = modelsByProvider.get(row.provider) ?? new Map();
    const m = models.get(model) ?? { model, events: 0, tokensIn: 0, tokensOut: 0 };
    m.events++;
    m.tokensIn += row.tokensIn;
    m.tokensOut += row.tokensOut;
    models.set(model, m);
    modelsByProvider.set(row.provider, models);
    byProvider.set(row.provider, entry);
  }
  const integrations = allIntegrationStatus(store);
  const statusByProvider = new Map<ProviderName, boolean>(integrations.map((i) => [i.provider, i.detected]));
  const result: ProviderUsageOverview[] = [];
  for (const [provider, entry] of byProvider) {
    entry.detected = statusByProvider.get(provider as ProviderName) ?? false;
    entry.models = [...(modelsByProvider.get(provider)?.values() ?? [])].sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));
    result.push(entry);
  }
  return result.sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));
}

export function setManualLimit(store: UsageStore, limit: Omit<LimitRow, "observedAt" | "source"> & { source?: LimitRow["source"] }): void {
  store.upsertLimit({ ...limit, source: limit.source ?? "manual", observedAt: new Date().toISOString() });
}

export function revokeProvider(store: UsageStore, provider: UsageProvider): { usage: number; limits: number } {
  setConsent(store, provider, "credentials", false);
  setConsent(store, provider, "live", false);
  return store.clearProviderUsage(provider);
}

export function clearExternalUsage(store: UsageStore, provider?: UsageProvider): number {
  return provider === undefined
    ? Number((store.db.prepare("DELETE FROM external_usage").run() as { changes: number }).changes)
    : Number((store.db.prepare("DELETE FROM external_usage WHERE provider = ?").run(provider) as { changes: number }).changes);
}

export function integrationOverview(store: UsageStore): ReturnType<typeof allIntegrationStatus> {
  return allIntegrationStatus(store);
}
