import { CONTROL_DIR } from "./config.js";
import type { SQLInputValue } from "node:sqlite";
import { setUsageMutationHook, type UsageStore } from "./usage.js";

export const USAGE_CACHE_TTL_MS = 5_000;

export interface RunSummary {
  runId: string;
  agentKey: string;
  version: string;
  interfaceName: string;
  sandbox: string;
  state: string;
  health: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  exitCode?: number;
  exitReason?: string;
  modelProvider?: string;
  modelName?: string;
}

export interface UsageStats {
  generatedAt: string;
  lastEventAt: string | null;
  range: { from?: string; to?: string };
  runs: {
    running: number;
    healthy: number;
    unhealthy: number;
    stopped: number;
    failed: number;
    today: number;
    allTime: number;
    lastSuccessfulRun: RunSummary | null;
    lastFailedRun: RunSummary | null;
  };
  containers: { current: number; historical: number };
  tokens: { input: number; output: number; reasoning: number; cache: number; available: boolean };
  cost: { exact: number; estimated: number; exactAvailable: boolean; estimatedAvailable: boolean };
  models: Array<{ provider: string; model: string; runs: number; tokensIn: number; tokensOut: number }>;
  sandboxes: Record<string, number>;
  perAgent: Array<{ agentKey: string; runs: number; running: number; lastRunAt: string | null }>;
  activeRuns: RunSummary[];
}

export interface StatsRange {
  from?: string;
  to?: string;
  agent?: string;
}

const ACTIVE = new Set(["starting", "running", "stopping"]);
const CONTAINER_SANDBOX = "container";

function dayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function runSummary(row: Record<string, unknown>): RunSummary {
  const summary: RunSummary = {
    runId: String(row.run_id),
    agentKey: String(row.agent_key),
    version: String(row.version),
    interfaceName: String(row.interface_name),
    sandbox: String(row.sandbox),
    state: String(row.state),
    health: String(row.health),
    startedAt: String(row.started_at),
  };
  if (row.ended_at) summary.endedAt = String(row.ended_at);
  if (row.exit_code !== null && row.exit_code !== undefined) summary.exitCode = Number(row.exit_code);
  if (row.exit_reason) summary.exitReason = String(row.exit_reason);
  if (row.model_provider) summary.modelProvider = String(row.model_provider);
  if (row.model_name) summary.modelName = String(row.model_name);
  if (summary.endedAt && !Number.isNaN(Date.parse(summary.startedAt))) {
    const elapsed = Date.parse(summary.endedAt) - Date.parse(summary.startedAt);
    if (elapsed > 0) summary.durationSec = Math.round(elapsed / 1000);
  }
  return summary;
}

export function computeUsageStats(store: UsageStore, range: StatsRange = {}): UsageStats {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (range.from) {
    where.push("started_at >= ?");
    params.push(new Date(range.from).toISOString());
  }
  if (range.to) {
    where.push("started_at <= ?");
    params.push(new Date(range.to).toISOString());
  }
  if (range.agent) {
    where.push("agent_key = ?");
    params.push(range.agent);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const runs = store.db.prepare(`SELECT * FROM runs ${whereSql} ORDER BY started_at`).all(...params) as Record<string, unknown>[];

  const active = runs.filter((r) => ACTIVE.has(String(r.state)));
  const healthy = active.filter((r) => String(r.health) === "ok").length;
  const unhealthy = active.filter((r) => String(r.health) === "unhealthy").length;
  const stopped = runs.filter((r) => !ACTIVE.has(String(r.state)) && String(r.state) !== "failed").length;
  const failed = runs.filter((r) => String(r.state) === "failed").length;
  const succeeded = runs.filter((r) => String(r.state) === "exited");
  const lastSuccessfulRun = succeeded.length > 0 ? runSummary(succeeded[succeeded.length - 1]) : null;
  const failedRuns = runs.filter((r) => String(r.state) === "failed");
  const lastFailedRun = failedRuns.length > 0 ? runSummary(failedRuns[failedRuns.length - 1]) : null;

  const todayStart = dayStart();
  const runsToday = runs.filter((r) => String(r.started_at) >= todayStart).length;

  const containersCurrent = active.filter((r) => String(r.sandbox) === CONTAINER_SANDBOX).length;
  const containersHistorical = runs.filter((r) => String(r.sandbox) === CONTAINER_SANDBOX).length;

  const usageRows = store.db.prepare("SELECT * FROM token_usage").all() as Record<string, unknown>[];
  const inScopeRunIds = new Set(runs.map((r) => String(r.run_id)));
  const tokens = { input: 0, output: 0, reasoning: 0, cache: 0, available: false };
  const cost = { exact: 0, estimated: 0, exactAvailable: false, estimatedAvailable: false };
  const models = new Map<string, { provider: string; model: string; runs: number; tokensIn: number; tokensOut: number }>();
  const modelUsageRuns = new Map<string, Set<string>>();
  for (const u of usageRows) {
    if (!inScopeRunIds.has(String(u.run_id))) continue;
    tokens.available = true;
    tokens.input += Number(u.tokens_in) || 0;
    tokens.output += Number(u.tokens_out) || 0;
    tokens.reasoning += Number(u.tokens_reasoning) || 0;
    tokens.cache += Number(u.tokens_cache) || 0;
    const exact = Number(u.cost_exact);
    if (Number.isFinite(exact) && exact > 0) {
      cost.exact += exact;
      cost.exactAvailable = true;
    }
    const estimated = Number(u.cost_estimated);
    if (Number.isFinite(estimated) && estimated > 0) {
      cost.estimated += estimated;
      cost.estimatedAvailable = true;
    }
    const key = `${u.model_provider}:${u.model_name}`;
    const entry = models.get(key) ?? { provider: String(u.model_provider), model: String(u.model_name), runs: 0, tokensIn: 0, tokensOut: 0 };
    entry.tokensIn += Number(u.tokens_in) || 0;
    entry.tokensOut += Number(u.tokens_out) || 0;
    models.set(key, entry);
    const set = modelUsageRuns.get(key) ?? new Set();
    set.add(String(u.run_id));
    modelUsageRuns.set(key, set);
  }
  for (const [key, entry] of models) {
    entry.runs = modelUsageRuns.get(key)?.size ?? 0;
  }

  const sandboxes: Record<string, number> = {};
  for (const r of runs) sandboxes[String(r.sandbox)] = (sandboxes[String(r.sandbox)] ?? 0) + 1;

  const perAgentMap = new Map<string, { agentKey: string; runs: number; running: number; lastRunAt: string | null }>();
  for (const r of runs) {
    const agentKey = String(r.agent_key);
    const entry = perAgentMap.get(agentKey) ?? { agentKey, runs: 0, running: 0, lastRunAt: null };
    entry.runs++;
    if (ACTIVE.has(String(r.state))) entry.running++;
    const started = String(r.started_at);
    if (!entry.lastRunAt || started > entry.lastRunAt) entry.lastRunAt = started;
    perAgentMap.set(agentKey, entry);
  }

  const activeRuns: RunSummary[] = runs.filter((r) => ACTIVE.has(String(r.state))).map(runSummary);
  for (const a of activeRuns) {
    const elapsed = Date.now() - Date.parse(a.startedAt);
    if (elapsed > 0) a.durationSec = Math.round(elapsed / 1000);
  }
  activeRuns.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));

  return {
    generatedAt: new Date().toISOString(),
    lastEventAt: store.lastEventAt(),
    range,
    runs: {
      running: active.length,
      healthy,
      unhealthy,
      stopped,
      failed,
      today: runsToday,
      allTime: runs.length,
      lastSuccessfulRun,
      lastFailedRun,
    },
    containers: { current: containersCurrent, historical: containersHistorical },
    tokens,
    cost,
    models: [...models.values()].sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut)),
    sandboxes,
    perAgent: [...perAgentMap.values()].sort((a, b) => b.runs - a.runs),
    activeRuns,
  };
}

interface CacheEntry {
  at: number;
  stats: UsageStats;
}

let cache = new Map<string, CacheEntry>();
let storeSnapshot: UsageStore | null = null;
let cacheKeyVersion = 0;

setUsageMutationHook(() => {
  cache.clear();
  cacheKeyVersion++;
});

export function invalidateUsageStats(): void {
  cache.clear();
  cacheKeyVersion++;
}

function cacheKey(store: UsageStore, range: StatsRange): string {
  return `${cacheKeyVersion}|${range.from ?? ""}|${range.to ?? ""}|${range.agent ?? ""}`;
}

export function getUsageStats(store: UsageStore, range: StatsRange = {}, ttlMs: number = USAGE_CACHE_TTL_MS): UsageStats {
  if (store !== storeSnapshot) {
    cache.clear();
    storeSnapshot = store;
  }
  const key = cacheKey(store, range);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < ttlMs && entry.stats.lastEventAt === store.lastEventAt()) {
    return entry.stats;
  }
  const stats = computeUsageStats(store, range);
  cache.set(key, { at: Date.now(), stats });
  return stats;
}

export function usageStorePath(): string {
  return process.env.AGENT_USAGE_DB ?? `${CONTROL_DIR}/usage.db`;
}
