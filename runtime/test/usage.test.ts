import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageStore, USAGE_SCHEMA_VERSION, type RunFacts, type UsageSample } from "../dist/usage.js";
import { computeUsageStats, getUsageStats, invalidateUsageStats } from "../dist/observability.js";

let home: string;
let dbPath: string;
let store: UsageStore;

function run(overrides: Partial<RunFacts> = {}): RunFacts {
  return {
    runId: "r-test-a1b2",
    agentKey: "demo/hello",
    version: "1.0.0",
    interfaceName: "cli",
    sandbox: "process",
    state: "exited",
    health: "unknown",
    exitCode: 0,
    exitReason: "exit",
    createdAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:00.000Z",
    endedAt: "2026-08-01T10:00:05.000Z",
    ...overrides,
  };
}

function usage(overrides: Partial<UsageSample> = {}): UsageSample {
  return {
    runId: "r-test-a1b2",
    modelProvider: "openai",
    modelName: "gpt-4o-mini",
    tokensIn: 100,
    tokensOut: 50,
    ...overrides,
  };
}

before(() => {
  home = mkdtempSync(join(tmpdir(), "oah-usage-"));
  dbPath = join(home, "usage.db");
  process.env.AGENT_USAGE_DB = dbPath;
});

beforeEach(() => {
  store = new UsageStore(dbPath);
  store.deleteAll();
});

after(() => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
  delete process.env.AGENT_USAGE_DB;
  rmSync(home, { recursive: true, force: true });
});

describe("usage store", () => {
  it("creates the schema at the current version", () => {
    assert.equal(store.schemaVersion(), USAGE_SCHEMA_VERSION);
  });

  it("upserts a run row idempotently", () => {
    store.syncRun(run({ state: "starting", exitCode: undefined, exitReason: undefined }));
    store.syncRun(run({ state: "exited" }));
    const rows = store.db.prepare("SELECT count(*) AS n FROM runs").get() as { n: number };
    assert.equal(rows.n, 1);
    const row = store.db.prepare("SELECT state, exit_code, ended_at FROM runs WHERE run_id = ?").get("r-test-a1b2") as {
      state: string;
      exit_code: number | null;
      ended_at: string;
    };
    assert.equal(row.state, "exited");
    assert.equal(row.exit_code, 0);
    assert.equal(row.ended_at, "2026-08-01T10:00:05.000Z");
  });

  it("records usage samples with exact and estimated costs kept separate", () => {
    store.recordUsage(usage({ costExact: 0.0004, costEstimated: 0.00041 }));
    store.recordUsage(usage({ runId: "r-other-9", tokensIn: 10, costExact: undefined, costEstimated: 0.0001 }));
    const rows = store.db.prepare("SELECT * FROM token_usage").all() as Record<string, unknown>[];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(!("prompt" in row) && !("content" in row) && !("input" in row) && !("secret" in row));
      assert.ok(!("response" in row) && !("env" in row));
    }
  });

  it("persists runs across reopen (duration and status survive)", () => {
    store.syncRun(run({ runId: "r-persist-1", state: "failed", exitCode: 1, exitReason: "crashed" }));
    store.close();
    const reopened = new UsageStore(dbPath);
    const stats = computeUsageStats(reopened);
    assert.equal(stats.runs.failed, 1);
    assert.equal(stats.runs.lastFailedRun?.runId, "r-persist-1");
    assert.equal(stats.runs.lastFailedRun?.durationSec, 5);
    reopened.close();
    store = new UsageStore(dbPath);
  });

  it("prunes runs by age and keeps only the newest N", () => {
    store.syncRun(run({ runId: "r-old-1", createdAt: "2026-01-01T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-old-2", createdAt: "2026-01-02T00:00:00.000Z" }));
    store.recordUsage(usage({ runId: "r-old-1" }));
    const byAge = store.prune({ olderThanDays: 30 });
    assert.equal(byAge.runsRemoved, 2);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM token_usage").get().n, 0);
    store.syncRun(run({ runId: "r-keep-1", createdAt: "2026-08-01T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-keep-2", createdAt: "2026-08-02T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-keep-3", createdAt: "2026-08-03T00:00:00.000Z" }));
    const byKeep = store.prune({ keep: 2 });
    assert.equal(byKeep.runsRemoved, 1);
    const remaining = store.db.prepare("SELECT run_id FROM runs").all() as { run_id: string }[];
    assert.deepEqual(remaining.map((r) => r.run_id).sort(), ["r-keep-2", "r-keep-3"]);
  });

  it("honors retention settings via pruneBySettings", () => {
    store.setSetting("retention.days", "30");
    store.setSetting("retention.max_runs", "0");
    store.syncRun(run({ runId: "r-ret-1", createdAt: "2026-01-15T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-ret-2", createdAt: "2026-08-01T00:00:00.000Z" }));
    const pruned = store.pruneBySettings();
    assert.equal(pruned.runsRemoved, 1);
    assert.equal(store.getSetting("retention.days"), "30");
    store.deleteAll();
    assert.equal(store.getSetting("retention.days"), null);
  });

  it("lists prune candidates without deleting", () => {
    store.syncRun(run({ runId: "r-cand-1", createdAt: "2026-01-01T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-cand-2", createdAt: "2026-08-01T00:00:00.000Z" }));
    const candidates = store.pruneCandidates({ olderThanDays: 30 });
    assert.deepEqual(candidates, ["r-cand-1"]);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM runs").get().n, 2);
  });

  it("exports structured data without logs or prompt content", () => {
    store.syncRun(run());
    store.recordUsage(usage());
    const data = store.exportData();
    assert.equal(data.runs.length, 1);
    assert.equal(data.usage.length, 1);
    const runRow = JSON.stringify(data.runs[0]);
    assert.ok(!runRow.includes("stdout") && !runRow.includes("stderr") && !runRow.includes("log"));
    assert.ok(!runRow.includes("prompt") && !runRow.includes("secret") && !runRow.includes("token"));
  });

  it("pruneById removes a single run and its usage", () => {
    store.syncRun(run({ runId: "r-single-1" }));
    store.recordUsage(usage({ runId: "r-single-1" }));
    assert.equal(store.pruneById("r-single-1"), 1);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
  });

  it("lastEventAt reflects the newest recorded event", () => {
    assert.equal(store.lastEventAt(), null);
    store.syncRun(run({ runId: "r-ev-1" }));
    assert.equal(store.lastEventAt(), "2026-08-01T10:00:00.000Z");
    store.recordUsage(usage({ runId: "r-ev-1", recordedAt: "2026-08-02T10:00:00.000Z" }));
    assert.equal(store.lastEventAt(), "2026-08-02T10:00:00.000Z");
  });
});

describe("usage stats", () => {
  beforeEach(() => {
    store.deleteAll();
  });

  it("aggregates run states, health, and containers", () => {
    store.syncRun(run({ runId: "r-a", state: "running", health: "ok" }));
    store.syncRun(run({ runId: "r-b", state: "running", health: "unhealthy" }));
    store.syncRun(run({ runId: "r-c", state: "starting", health: "unknown" }));
    store.syncRun(run({ runId: "r-d", state: "exited", exitCode: 0, exitReason: "exit" }));
    store.syncRun(run({ runId: "r-e", state: "failed", exitCode: 1, exitReason: "crashed" }));
    store.syncRun(run({ runId: "r-f", state: "orphaned", exitReason: "supervisor-gone" }));
    store.syncRun(run({ runId: "r-g", state: "running", health: "ok", sandbox: "container", containerId: "abc" }));

    const stats = computeUsageStats(store);
    assert.equal(stats.runs.running, 4);
    assert.equal(stats.runs.healthy, 2);
    assert.equal(stats.runs.unhealthy, 1);
    assert.equal(stats.runs.stopped, 2);
    assert.equal(stats.runs.failed, 1);
    assert.equal(stats.runs.allTime, 7);
    assert.equal(stats.containers.current, 1);
    assert.equal(stats.containers.historical, 1);
    assert.equal(stats.activeRuns.length, 4);
    assert.ok(stats.activeRuns.every((r) => r.durationSec !== undefined));
    assert.deepEqual(Object.keys(stats.sandboxes).sort(), ["container", "process"]);
    assert.equal(stats.sandboxes.process, 6);
  });

  it("distinguishes zero usage from unavailable data", () => {
    store.syncRun(run());
    const stats = computeUsageStats(store);
    assert.equal(stats.tokens.available, false);
    assert.equal(stats.tokens.input, 0);
    assert.equal(stats.cost.exactAvailable, false);
    assert.equal(stats.cost.estimatedAvailable, false);
    store.recordUsage(usage({ tokensIn: 0, tokensOut: 0 }));
    const withZero = computeUsageStats(store);
    assert.equal(withZero.tokens.available, true);
    assert.equal(withZero.tokens.input, 0);
  });

  it("splits tokens by category and never combines exact with estimated cost", () => {
    store.syncRun(run());
    store.syncRun(run({ runId: "r-x-1" }));
    store.recordUsage(usage({ tokensIn: 100, tokensOut: 50, tokensReasoning: 20, tokensCache: 30, costExact: 0.0005, costEstimated: 0.00055 }));
    store.recordUsage(usage({ runId: "r-x-1", tokensIn: 10, tokensOut: 5, costExact: 0.0001, costEstimated: 0.00011 }));
    const stats = computeUsageStats(store);
    assert.equal(stats.tokens.input, 110);
    assert.equal(stats.tokens.output, 55);
    assert.equal(stats.tokens.reasoning, 20);
    assert.equal(stats.tokens.cache, 30);
    assert.ok(Math.abs(stats.cost.exact - 0.0006) < 1e-9);
    assert.ok(Math.abs(stats.cost.estimated - 0.00066) < 1e-9);
    assert.ok(stats.cost.estimated > stats.cost.exact);
    assert.equal(stats.models.length, 1);
    assert.equal(stats.models[0].runs, 2);
  });

  it("keeps container counts accurate after a container is removed", () => {
    store.syncRun(run({ runId: "r-ctr-1", state: "running", health: "ok", sandbox: "container", containerId: "c1" }));
    assert.equal(computeUsageStats(store).containers.current, 1);
    store.syncRun(run({ runId: "r-ctr-1", state: "exited", sandbox: "container", exitReason: "container-gone", endedAt: "2026-08-01T10:00:10.000Z" }));
    const stats = computeUsageStats(store);
    assert.equal(stats.containers.current, 0);
    assert.equal(stats.containers.historical, 1);
    assert.equal(stats.runs.running, 0);
  });

  it("reports last successful and failed runs", () => {
    store.syncRun(run({ runId: "r-ok-2", startedAt: "2026-08-02T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-bad", state: "failed", exitCode: 1, exitReason: "crashed", startedAt: "2026-08-03T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-ok-1", startedAt: "2026-08-01T00:00:00.000Z" }));
    const stats = computeUsageStats(store);
    assert.equal(stats.runs.lastSuccessfulRun?.runId, "r-ok-2");
    assert.equal(stats.runs.lastFailedRun?.runId, "r-bad");
  });

  it("filters by date range and agent, counting tokens only for in-scope runs", () => {
    store.syncRun(run({ runId: "r-f1", agentKey: "demo/alpha", startedAt: "2026-08-01T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-f2", agentKey: "demo/alpha", startedAt: "2026-08-10T00:00:00.000Z" }));
    store.syncRun(run({ runId: "r-f3", agentKey: "demo/beta", startedAt: "2026-08-05T00:00:00.000Z" }));
    store.recordUsage(usage({ runId: "r-f2", tokensIn: 40, tokensOut: 10 }));
    store.recordUsage(usage({ runId: "r-f3", tokensIn: 90, tokensOut: 10 }));

    const ranged = computeUsageStats(store, { from: "2026-08-08" });
    assert.equal(ranged.runs.allTime, 1);
    assert.equal(ranged.tokens.input, 40);

    const byAgent = computeUsageStats(store, { agent: "demo/alpha" });
    assert.equal(byAgent.runs.allTime, 2);
    assert.equal(byAgent.tokens.input, 40);
    assert.equal(byAgent.perAgent.length, 1);
  });

  it("caches aggregation and invalidates on mutation", () => {
    store.syncRun(run({ runId: "r-cache-1" }));
    const first = getUsageStats(store);
    const second = getUsageStats(store);
    assert.equal(first, second);
    store.syncRun(run({ runId: "r-cache-2" }));
    const third = getUsageStats(store);
    assert.notEqual(third, first);
    assert.equal(third.runs.allTime, 2);
    invalidateUsageStats();
  });
});
