import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { CONTROL_DIR } from "./config.js";

export const USAGE_DB_PATH = join(CONTROL_DIR, "usage.db");
export const USAGE_SCHEMA_VERSION = 2;
export const USAGE_RETENTION_KEYS = ["retention.days", "retention.max_runs"] as const;
export const USAGE_FILE_ENV = "AGENT_USAGE_FILE";

export type UsageProvider = "claude" | "codex" | "opencode";

export interface ExternalUsageRow {
  provider: UsageProvider;
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

export interface LimitRow {
  provider: UsageProvider;
  window: string;
  plan?: string;
  usedPercent?: number;
  units?: string;
  creditsUsed?: number;
  creditsTotal?: number;
  resetAt?: string;
  observedAt: string;
  source: "local" | "live" | "manual";
}

export interface SourceCursor {
  source: string;
  size: number;
  mtimeMs: number;
  offset: number;
  seenAt: string;
}

export interface RunFacts {
  runId: string;
  agentKey: string;
  version: string;
  interfaceName: "cli" | "mcp" | "http";
  sandbox: "container" | "process" | "none";
  state: string;
  health: string;
  exitCode?: number;
  exitReason?: string;
  modelProvider?: string;
  modelName?: string;
  containerId?: string;
  createdAt: string;
  startedAt: string;
  endedAt?: string;
}

export interface UsageSample {
  runId: string;
  modelProvider: string;
  modelName: string;
  tokensIn: number;
  tokensOut: number;
  tokensReasoning?: number;
  tokensCache?: number;
  costExact?: number;
  costEstimated?: number;
  recordedAt?: string;
}

export interface ResourceSample {
  runId: string;
  memBytes?: number;
  cpuPercent?: number;
  containerId?: string;
  sampledAt?: string;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    agent_key TEXT NOT NULL,
    version TEXT NOT NULL,
    interface_name TEXT NOT NULL,
    sandbox TEXT NOT NULL,
    state TEXT NOT NULL,
    health TEXT NOT NULL,
    exit_code INTEGER,
    exit_reason TEXT,
    model_provider TEXT,
    model_name TEXT,
    container_id TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE TABLE token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    tokens_in INTEGER NOT NULL,
    tokens_out INTEGER NOT NULL,
    tokens_reasoning INTEGER NOT NULL DEFAULT 0,
    tokens_cache INTEGER NOT NULL DEFAULT 0,
    cost_exact REAL,
    cost_estimated REAL,
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX idx_token_usage_run ON token_usage(run_id);
  CREATE INDEX idx_token_usage_time ON token_usage(recorded_at);
  CREATE TABLE resource_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    mem_bytes INTEGER,
    cpu_percent REAL,
    container_id TEXT,
    sampled_at TEXT NOT NULL
  );
  CREATE INDEX idx_resource_run ON resource_samples(run_id);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE external_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT,
    model TEXT,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    cost_exact REAL,
    cost_estimated REAL,
    occurred_at TEXT NOT NULL,
    event_key TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    UNIQUE (provider, source, event_key)
  );
  CREATE INDEX idx_external_time ON external_usage(occurred_at);
  CREATE INDEX idx_external_provider ON external_usage(provider);
  CREATE TABLE limits (
    provider TEXT NOT NULL,
    window TEXT NOT NULL,
    plan TEXT,
    used_percent REAL,
    units TEXT,
    credits_used REAL,
    credits_total REAL,
    reset_at TEXT,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (provider, window)
  );
  CREATE TABLE source_cursors (
    source TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    offset INTEGER NOT NULL DEFAULT 0,
    seen_at TEXT NOT NULL
  );
  CREATE TABLE codex_totals (
    source TEXT NOT NULL,
    model TEXT NOT NULL,
    last_input INTEGER NOT NULL DEFAULT 0,
    last_output INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source, model)
  );
  `,
];

export interface PruneOptions {
  olderThanDays?: number;
  keep?: number;
}

export function usageDbPath(): string {
  return process.env.AGENT_USAGE_DB ?? USAGE_DB_PATH;
}

export function openUsageStore(): UsageStore {
  return new UsageStore(usageDbPath());
}

export class UsageStore {
  readonly db: DatabaseSync;

  constructor(path: string = usageDbPath()) {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    const version = this.schemaVersion();
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.db.exec("BEGIN;");
      try {
        this.db.exec(MIGRATIONS[i]);
        this.db.exec(`PRAGMA user_version = ${i + 1};`);
        this.db.exec("COMMIT;");
      } catch (err) {
        this.db.exec("ROLLBACK;");
        throw err;
      }
    }
  }

  schemaVersion(): number {
    return Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  }

  close(): void {
    this.db.close();
  }

  syncRun(run: RunFacts): void {
    const existing = this.db.prepare("SELECT state FROM runs WHERE run_id = ?").get(run.runId) as { state: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE runs SET agent_key = ?, version = ?, interface_name = ?, sandbox = ?, state = ?, health = ?,
           exit_code = ?, exit_reason = ?, model_provider = ?, model_name = ?, container_id = ?,
           created_at = ?, started_at = ?, ended_at = ? WHERE run_id = ?`,
        )
        .run(
          run.agentKey,
          run.version,
          run.interfaceName,
          run.sandbox,
          run.state,
          run.health,
          run.exitCode ?? null,
          run.exitReason ?? null,
          run.modelProvider ?? null,
          run.modelName ?? null,
          run.containerId ?? null,
          run.createdAt,
          run.startedAt,
          run.endedAt ?? null,
          run.runId,
        );
      return;
    }
    this.db
      .prepare(
        `INSERT INTO runs (run_id, agent_key, version, interface_name, sandbox, state, health, exit_code, exit_reason,
         model_provider, model_name, container_id, created_at, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.agentKey,
        run.version,
        run.interfaceName,
        run.sandbox,
        run.state,
        run.health,
        run.exitCode ?? null,
        run.exitReason ?? null,
        run.modelProvider ?? null,
        run.modelName ?? null,
        run.containerId ?? null,
        run.createdAt,
        run.startedAt,
        run.endedAt ?? null,
      );
    this.touch();
  }

  recordUsage(sample: UsageSample): void {
    this.db
      .prepare(
        `INSERT INTO token_usage (run_id, model_provider, model_name, tokens_in, tokens_out, tokens_reasoning,
         tokens_cache, cost_exact, cost_estimated, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sample.runId,
        sample.modelProvider,
        sample.modelName,
        sample.tokensIn,
        sample.tokensOut,
        sample.tokensReasoning ?? 0,
        sample.tokensCache ?? 0,
        sample.costExact ?? null,
        sample.costEstimated ?? null,
        sample.recordedAt ?? new Date().toISOString(),
      );
    this.touch();
  }

  recordResourceSample(sample: ResourceSample): void {
    this.db
      .prepare(
        `INSERT INTO resource_samples (run_id, mem_bytes, cpu_percent, container_id, sampled_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sample.runId, sample.memBytes ?? null, sample.cpuPercent ?? null, sample.containerId ?? null, sample.sampledAt ?? new Date().toISOString());
    this.touch();
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  recordExternal(obs: ExternalUsageRow): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO external_usage (provider, source, session_id, model, tokens_in, tokens_out, cache_read,
         cache_write, cost_exact, cost_estimated, occurred_at, event_key, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        obs.provider,
        obs.source,
        obs.sessionId ?? null,
        obs.model ?? null,
        obs.tokensIn,
        obs.tokensOut,
        obs.cacheRead ?? 0,
        obs.cacheWrite ?? 0,
        obs.costExact ?? null,
        obs.costEstimated ?? null,
        obs.occurredAt,
        obs.eventKey,
        new Date().toISOString(),
      );
    const changed = res.changes > 0;
    if (changed) this.touch();
    return changed;
  }

  hasExternal(provider: UsageProvider, source: string, eventKey: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM external_usage WHERE provider = ? AND source = ? AND event_key = ?").get(provider, source, eventKey) !==
      undefined
    );
  }

  upsertLimit(obs: LimitRow): void {
    this.db
      .prepare(
        `INSERT INTO limits (provider, window, plan, used_percent, units, credits_used, credits_total, reset_at, observed_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, window) DO UPDATE SET plan = excluded.plan, used_percent = excluded.used_percent,
         units = excluded.units, credits_used = excluded.credits_used, credits_total = excluded.credits_total,
         reset_at = excluded.reset_at, observed_at = excluded.observed_at, source = excluded.source`,
      )
      .run(
        obs.provider,
        obs.window,
        obs.plan ?? null,
        obs.usedPercent ?? null,
        obs.units ?? null,
        obs.creditsUsed ?? null,
        obs.creditsTotal ?? null,
        obs.resetAt ?? null,
        obs.observedAt,
        obs.source,
      );
    this.touch();
  }

  listLimits(provider?: UsageProvider): LimitRow[] {
    const rows = provider
      ? this.db.prepare("SELECT * FROM limits WHERE provider = ? ORDER BY provider, window").all(provider)
      : this.db.prepare("SELECT * FROM limits ORDER BY provider, window").all();
    return (rows as Record<string, unknown>[]).map((r) => ({
      provider: String(r.provider) as UsageProvider,
      window: String(r.window),
      plan: r.plan !== null ? String(r.plan) : undefined,
      usedPercent: r.used_percent !== null ? Number(r.used_percent) : undefined,
      units: r.units !== null ? String(r.units) : undefined,
      creditsUsed: r.credits_used !== null ? Number(r.credits_used) : undefined,
      creditsTotal: r.credits_total !== null ? Number(r.credits_total) : undefined,
      resetAt: r.reset_at !== null ? String(r.reset_at) : undefined,
      observedAt: String(r.observed_at),
      source: String(r.source) as LimitRow["source"],
    }));
  }

  listExternalUsage(provider?: UsageProvider): ExternalUsageRow[] {
    const rows = provider
      ? this.db.prepare("SELECT * FROM external_usage WHERE provider = ? ORDER BY occurred_at").all(provider)
      : this.db.prepare("SELECT * FROM external_usage ORDER BY occurred_at").all();
    return (rows as Record<string, unknown>[]).map((r) => ({
      provider: String(r.provider) as UsageProvider,
      source: String(r.source),
      sessionId: r.session_id !== null ? String(r.session_id) : undefined,
      model: r.model !== null ? String(r.model) : undefined,
      tokensIn: Number(r.tokens_in),
      tokensOut: Number(r.tokens_out),
      cacheRead: Number(r.cache_read),
      cacheWrite: Number(r.cache_write),
      costExact: r.cost_exact !== null ? Number(r.cost_exact) : undefined,
      costEstimated: r.cost_estimated !== null ? Number(r.cost_estimated) : undefined,
      occurredAt: String(r.occurred_at),
      eventKey: String(r.event_key),
    }));
  }

  clearProviderUsage(provider: UsageProvider): { usage: number; limits: number } {
    const usage = Number((this.db.prepare("DELETE FROM external_usage WHERE provider = ?").run(provider) as { changes: number }).changes);
    const limits = Number((this.db.prepare("DELETE FROM limits WHERE provider = ?").run(provider) as { changes: number }).changes);
    this.touch();
    return { usage, limits };
  }

  getSourceCursor(source: string): SourceCursor | null {
    const row = this.db.prepare("SELECT * FROM source_cursors WHERE source = ?").get(source) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      source: String(row.source),
      size: Number(row.size),
      mtimeMs: Number(row.mtime_ms),
      offset: Number(row.offset),
      seenAt: String(row.seen_at),
    };
  }

  setSourceCursor(source: string, size: number, mtimeMs: number, offset: number): void {
    this.db
      .prepare(
        `INSERT INTO source_cursors (source, size, mtime_ms, offset, seen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, offset = excluded.offset, seen_at = excluded.seen_at`,
      )
      .run(source, size, mtimeMs, offset, new Date().toISOString());
  }

  getCodexTotal(source: string, model: string): { lastInput: number; lastOutput: number } | null {
    const row = this.db.prepare("SELECT * FROM codex_totals WHERE source = ? AND model = ?").get(source, model) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return { lastInput: Number(row.last_input), lastOutput: Number(row.last_output) };
  }

  setCodexTotal(source: string, model: string, lastInput: number, lastOutput: number): void {
    this.db
      .prepare(
        `INSERT INTO codex_totals (source, model, last_input, last_output, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source, model) DO UPDATE SET last_input = excluded.last_input, last_output = excluded.last_output, updated_at = excluded.updated_at`,
      )
      .run(source, model, lastInput, lastOutput, new Date().toISOString());
  }

  pruneCandidates(opts: PruneOptions): string[] {
    const ids = new Set<string>();
    if (opts.olderThanDays !== undefined && opts.olderThanDays >= 0) {
      const cutoff = new Date(Date.now() - opts.olderThanDays * 86_400_000).toISOString();
      for (const row of this.db.prepare("SELECT run_id FROM runs WHERE created_at < ?").all(cutoff)) {
        ids.add((row as { run_id: string }).run_id);
      }
    }
    if (opts.keep !== undefined && opts.keep >= 0) {
      for (const row of this.db.prepare("SELECT run_id FROM runs ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(opts.keep)) {
        ids.add((row as { run_id: string }).run_id);
      }
    }
    return [...ids];
  }

  prune(opts: PruneOptions): { runsRemoved: number; usageRemoved: number } {
    const ids = this.pruneCandidates(opts);
    const removed = ids.length > 0 ? this.removeRuns(`run_id IN (${ids.map(() => "?").join(", ")})`, ids) : 0;
    return { runsRemoved: removed, usageRemoved: removed };
  }

  pruneById(runId: string): number {
    return this.removeRuns(`run_id = ?`, [runId]);
  }

  pruneBySettings(): { runsRemoved: number } {
    const daysRaw = this.getSetting("retention.days");
    const keepRaw = this.getSetting("retention.max_runs");
    const days = daysRaw ? Number(daysRaw) : NaN;
    const keep = keepRaw ? Number(keepRaw) : NaN;
    if (!(days > 0) && !(keep > 0)) return { runsRemoved: 0 };
    return this.prune({ olderThanDays: days > 0 ? days : undefined, keep: keep > 0 ? keep : undefined });
  }

  private removeRuns(where: string, params: SQLInputValue[]): number {
    const rows = this.db.prepare(`SELECT run_id FROM runs WHERE ${where}`).all(...params) as { run_id: string }[];
    if (rows.length === 0) return 0;
    const stmt = this.db.prepare("DELETE FROM runs WHERE run_id = ?");
    const usage = this.db.prepare("DELETE FROM token_usage WHERE run_id = ?");
    const resource = this.db.prepare("DELETE FROM resource_samples WHERE run_id = ?");
    this.db.exec("BEGIN;");
    try {
      for (const row of rows) {
        usage.run(row.run_id);
        resource.run(row.run_id);
        stmt.run(row.run_id);
      }
      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
    this.touch();
    return rows.length;
  }

  exportData(): {
    runs: unknown[];
    usage: unknown[];
    resources: unknown[];
    settings: Record<string, string>;
    external: unknown[];
    limits: unknown[];
  } {
    const runs = this.db.prepare("SELECT * FROM runs ORDER BY created_at").all();
    const usage = this.db.prepare("SELECT * FROM token_usage ORDER BY recorded_at").all();
    const resources = this.db.prepare("SELECT * FROM resource_samples ORDER BY sampled_at").all();
    const external = this.db.prepare("SELECT * FROM external_usage ORDER BY occurred_at").all();
    const limits = this.db.prepare("SELECT * FROM limits ORDER BY provider, window").all();
    const settingsRows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const row of settingsRows) settings[row.key] = row.value;
    return { runs, usage, resources, settings, external, limits };
  }

  deleteAll(): void {
    this.db.exec("BEGIN;");
    try {
      this.db.exec(
        "DELETE FROM token_usage; DELETE FROM resource_samples; DELETE FROM runs; DELETE FROM settings; DELETE FROM external_usage; DELETE FROM limits; DELETE FROM source_cursors; DELETE FROM codex_totals;",
      );
      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
    this.touch();
  }

  lastEventAt(): string | null {
    const row = this.db
      .prepare("SELECT MAX(last) AS last FROM (SELECT MAX(created_at) AS last FROM runs UNION ALL SELECT MAX(recorded_at) AS last FROM token_usage)")
      .get() as { last: string | null };
    return row.last ?? null;
  }

  private touch(): void {
    usageMutationHook?.();
  }
}

let usageMutationHook: (() => void) | null = null;

export function setUsageMutationHook(fn: (() => void) | null): void {
  usageMutationHook = fn;
}
