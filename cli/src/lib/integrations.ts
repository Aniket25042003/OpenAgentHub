import { openUsageStore, collectProvidersSync, providerUsageOverview } from "@openagenthub/runtime";
import type { ProviderName, ProviderResult, ProviderUsageOverview, CollectionResult } from "@openagenthub/runtime";
import type { UsageProvider } from "@openagenthub/runtime";

export const PROVIDER_NAMES: string[] = ["claude", "codex", "opencode"];

export function isProvider(value: string): value is UsageProvider {
  return PROVIDER_NAMES.includes(value);
}

export interface ProviderData {
  collection: ProviderResult[];
  usage: ProviderUsageOverview[];
  limits: unknown[];
}

export function collectProviderData(provider?: UsageProvider): ProviderData {
  const store = openUsageStore();
  try {
    const providers = provider ? [provider] : undefined;
    const collection = collectProvidersSync(store, { providers });
    const usage = providerUsageOverview(store).filter((p) => provider === undefined || p.provider === provider);
    const limits = store.listLimits(provider ? provider : undefined);
    return { collection: collection.providers, usage, limits };
  } finally {
    store.close();
  }
}