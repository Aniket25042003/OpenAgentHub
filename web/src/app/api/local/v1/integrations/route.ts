import { NextResponse } from "next/server";
import { openUsageStore, allIntegrationStatus, providerSource } from "@openagenthub/runtime";
import { collectProvidersSync, providerUsageOverview, revokeProvider } from "@openagenthub/runtime";
import { setEnabled, setConsent } from "@openagenthub/runtime";
import type { ProviderName } from "@openagenthub/runtime";

const PROVIDERS: ProviderName[] = ["claude", "codex", "opencode"];

export async function GET(): Promise<Response> {
  const store = openUsageStore();
  try {
    const collection = collectProvidersSync(store, {});
    const statuses = allIntegrationStatus(store).map((s) => ({
      provider: s.provider,
      enabled: s.enabled,
      detected: s.detected,
      consent: { credentials: s.credentials, live: s.live },
      source: providerSource(s.provider),
      collected: collection.providers.find((p) => p.provider === s.provider)?.status ?? "unknown",
    }));
    return NextResponse.json({
      integrations: statuses,
      usage: providerUsageOverview(store),
      limits: store.listLimits(),
    });
  } finally {
    store.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    provider: string;
    action: "enable" | "disable";
    credentials?: boolean;
    live?: boolean;
    collect?: boolean;
  };
  const provider = body.provider as ProviderName;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "unsupported provider" }, { status: 400 });
  }
  const store = openUsageStore();
  try {
    if (body.action === "disable") {
      const removed = revokeProvider(store, provider);
      setEnabled(store, provider, false);
      return NextResponse.json({ provider, enabled: false, removed: { usageEvents: removed.usage, limitRows: removed.limits } });
    }
    if (body.action === "enable") {
      setEnabled(store, provider, true);
      if (body.credentials !== undefined) setConsent(store, provider, "credentials", body.credentials);
      if (body.live !== undefined) setConsent(store, provider, "live", body.live);
    }
    if (body.collect) {
      collectProvidersSync(store, { providers: [provider] });
    }
    const status = allIntegrationStatus(store).find((s) => s.provider === provider);
    return NextResponse.json(status);
  } finally {
    store.close();
  }
}