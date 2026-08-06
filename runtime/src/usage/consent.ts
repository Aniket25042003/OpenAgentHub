import type { UsageStore, UsageProvider } from "../usage.js";
import { providerDetected } from "./detect.js";
import { PROVIDERS } from "./types.js";

export type ConsentKind = "credentials" | "live";

export interface IntegrationStatus {
  provider: UsageProvider;
  enabled: boolean;
  credentials: boolean;
  live: boolean;
  detected: boolean;
}

export function consentKey(provider: UsageProvider, kind: ConsentKind): string {
  return `integration.${provider}.${kind}`;
}

export function enabledKey(provider: UsageProvider): string {
  return `integration.${provider}.enabled`;
}

export function setEnabled(store: UsageStore, provider: UsageProvider, enabled: boolean): void {
  store.setSetting(enabledKey(provider), enabled ? "1" : "0");
}

export function setConsent(store: UsageStore, provider: UsageProvider, kind: ConsentKind, granted: boolean): void {
  store.setSetting(consentKey(provider, kind), granted ? "1" : "0");
}

export function consent(store: UsageStore, provider: UsageProvider, kind: ConsentKind): boolean {
  return store.getSetting(consentKey(provider, kind)) === "1";
}

export function enabled(store: UsageStore, provider: UsageProvider): boolean {
  const v = store.getSetting(enabledKey(provider));
  return v === null || v === "1";
}

export function integrationStatus(store: UsageStore, provider: UsageProvider): IntegrationStatus {
  return { provider, enabled: enabled(store, provider), credentials: consent(store, provider, "credentials"), live: consent(store, provider, "live"), detected: providerDetected(provider) };
}

export function allIntegrationStatus(store: UsageStore): IntegrationStatus[] {
  return PROVIDERS.map(integrationStatus.bind(null, store));
}
