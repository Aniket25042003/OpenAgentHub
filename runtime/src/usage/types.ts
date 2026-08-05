export type ProviderName = "claude" | "codex" | "opencode";

export const PROVIDERS: ProviderName[] = ["claude", "codex", "opencode"];

export type ProviderStatus =
  | "ok"
  | "unsupported"
  | "locked"
  | "error"
  | "timeboxed"
  | "disabled"
  | "missing";

export interface UsageObservation {
  provider: ProviderName;
  source: string;
  sessionId?: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead?: number;
  cacheWrite?: number;
  costExact?: number;
  costEstimated?: number;
  occurredAt: string;
  eventKey: string;
}

export interface LimitObservation {
  provider: ProviderName;
  window: string;
  plan?: string;
  usedPercent?: number;
  units?: string;
  creditsUsed?: number;
  creditsTotal?: number;
  resetAt?: string;
  source: "local" | "live" | "manual";
}

export interface ProviderResult {
  provider: ProviderName;
  detected: boolean;
  status: ProviderStatus;
  sourcesScanned: number;
  eventsIngested: number;
  eventsSkipped: number;
  timeMs: number;
  message?: string;
}

export interface CollectionResult {
  generatedAt: string;
  providers: ProviderResult[];
  usage: UsageObservation[];
  limits: LimitObservation[];
  timeboxed: boolean;
}

export interface AdapterOutput {
  usage: UsageObservation[];
  limits: LimitObservation[];
  result: ProviderResult;
}

export interface ProviderSource {
  provider: ProviderName;
  root: string;
  dataDir: string;
  displayName: string;
  description: string;
  files: string[];
  endpoints: string[];
}

export function isUsageObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
