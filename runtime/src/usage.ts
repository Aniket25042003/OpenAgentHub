import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { CONTROL_DIR } from "./config.js";

export const USAGE_DB_PATH = join(CONTROL_DIR, "usage.db");
export const USAGE_SCHEMA_VERSION = 1;
export const USAGE_RETENTION_KEYS = ["retention.days", "retention.max_runs"] as const;
export const USAGE_FILE_ENV = "AGENT_USAGE_FILE";

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

  exportData(): { runs: unknown[]; usage: unknown[]; resources: unknown[]; settings: Record<string, string> } {
    const runs = this.db.prepare("SELECT * FROM runs ORDER BY created_at").all();
    const usage = this.db.prepare("SELECT * FROM token_usage ORDER BY recorded_at").all();
    const resources = this.db.prepare("SELECT * FROM resource_samples ORDER BY sampled_at").all();
    const settingsRows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const row of settingsRows) settings[row.key] = row.value;
    return { runs, usage, resources, settings };
  }

  deleteAll(): void {
    this.db.exec("BEGIN;");
    try {
      this.db.exec("DELETE FROM token_usage; DELETE FROM resource_samples; DELETE FROM runs; DELETE FROM settings;");
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
