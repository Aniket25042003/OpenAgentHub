import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { UsageStore } from "../dist/usage.js";
import { collectClaude } from "../dist/usage/claude.js";
import { collectCodex } from "../dist/usage/codex.js";
import { collectOpencode } from "../dist/usage/opencode.js";
import { collectProvidersSync, providerUsageOverview, revokeProvider, setManualLimit } from "../dist/usage/collect.js";
import { setConsent, setEnabled } from "../dist/usage/consent.js";
import { fetchLiveLimits } from "../dist/usage/live.js";

let home: string;
let dbPath: string;
let store: UsageStore;
let claudeDir: string;
let codexDir: string;
let opencodeDir: string;

const settings = (key: string) => store.getSetting(key);

function claudeEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00.000Z",
    message: {
      uuid: "evt-1",
      model: "claude-sonnet-4-20250514",
      session_id: "s1",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
        cost_usd: 0.001,
      },
      ...overrides,
    },
  });
}

before(() => {
  home = mkdtempSync(join(tmpdir(), "oah-adapters-"));
  dbPath = join(home, "usage.db");
  claudeDir = join(home, "claude");
  codexDir = join(home, "codex");
  opencodeDir = join(home, "opencode");
  process.env.AGENT_USAGE_DB = dbPath;
  process.env.OPENAGENTHUB_CLAUDE_DIR = claudeDir;
  process.env.OPENAGENTHUB_CODEX_DIR = codexDir;
  process.env.OPENAGENTHUB_OPENCODE_DIR = opencodeDir;
});

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(codexDir, { recursive: true });
  mkdirSync(opencodeDir, { recursive: true });
  store = new UsageStore(dbPath);
  store.deleteAll();
  setEnabled(store, "claude", true);
  setEnabled(store, "codex", true);
  setEnabled(store, "opencode", true);
  setConsent(store, "claude", "credentials", true);
  setConsent(store, "codex", "credentials", true);
  setConsent(store, "opencode", "credentials", true);
});

after(() => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
  delete process.env.AGENT_USAGE_DB;
  delete process.env.OPENAGENTHUB_CLAUDE_DIR;
  delete process.env.OPENAGENTHUB_CODEX_DIR;
  delete process.env.OPENAGENTHUB_OPENCODE_DIR;
  rmSync(home, { recursive: true, force: true });
});

describe("claude adapter", () => {
  it("parses session JSONL into deterministic normalized observations", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    writeFileSync(
      join(claudeDir, "projects", "p1", "session-a.jsonl"),
      [
        claudeEvent(),
        claudeEvent({ uuid: "evt-2", usage: { input_tokens: 200, output_tokens: 100 } }),
        JSON.stringify({ type: "user", timestamp: "2026-08-01T10:01:00.000Z", message: { content: "hello" } }),
        "not-json",
        claudeEvent({ uuid: "evt-3", usage: { input_tokens: 5, output_tokens: 2 } }),
        "",
      ].join("\n"),
    );

    const out = collectClaude(store, 2000, settings);
    assert.equal(out.result.status, "ok");
    assert.equal(out.result.sourcesScanned, 1);
    assert.equal(out.usage.length, 3);
    assert.equal(out.result.eventsIngested, 3);
    assert.equal(out.result.eventsSkipped, 2);

    const first = out.usage[0];
    assert.equal(first.provider, "claude");
    assert.equal(first.tokensIn, 100);
    assert.equal(first.tokensOut, 50);
    assert.equal(first.cacheWrite, 10);
    assert.equal(first.cacheRead, 5);
    assert.equal(first.costExact, 0.001);
    assert.equal(first.costEstimated, undefined);
    assert.equal(first.model, "claude-sonnet-4-20250514");
    assert.equal(first.sessionId, "s1");

    const third = out.usage[2];
    assert.equal(third.costExact, undefined);
    assert.ok(third.costEstimated !== undefined && third.costEstimated > 0);
  });

  it("does not duplicate usage on repeated parsing", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    const file = join(claudeDir, "projects", "p1", "session-a.jsonl");
    writeFileSync(file, [claudeEvent(), claudeEvent({ uuid: "evt-2", usage: { input_tokens: 10, output_tokens: 5 } })].join("\n") + "\n");

    const first = collectProvidersSync(store, { providers: ["claude"] });
    assert.equal(first.usage.length, 2);
    const second = collectProvidersSync(store, { providers: ["claude"] });
    assert.equal(second.usage.length, 0);
    assert.equal(store.listExternalUsage("claude").length, 2);
  });

  it("resumes from the cursor on appended lines and handles partial final lines", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    const file = join(claudeDir, "projects", "p1", "session-a.jsonl");
    writeFileSync(file, claudeEvent() + "\n" + claudeEvent({ uuid: "evt-2", usage: { input_tokens: 10, output_tokens: 5 } }) + "\n");

    const first = collectClaude(store, 2000, settings);
    assert.equal(first.usage.length, 2);
    assert.equal(first.usage[1].occurredAt, "2026-08-01T10:00:00.000Z");

    const partial = JSON.stringify({ type: "assistant", timestamp: "2026-08-01T11:00:00.000Z", message: { uuid: "evt-3", usage: { input_tokens: 30, output_tokens: 15 } } });
    writeFileSync(file, readFileSync(file, "utf8") + "\n" + partial.slice(0, 40));
    const second = collectClaude(store, 2000, settings);
    assert.equal(second.usage.length, 0, "partial final line must not be ingested");

    writeFileSync(file, readFileSync(file, "utf8") + partial.slice(40) + "\n");
    const third = collectClaude(store, 2000, settings);
    assert.equal(third.usage.length, 1);
    assert.equal(third.usage[0].eventKey, "evt-3");
  });

  it("does not duplicate when a file is replaced with different content", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    const file = join(claudeDir, "projects", "p1", "session-a.jsonl");
    writeFileSync(file, claudeEvent() + "\n");
    collectProvidersSync(store, { providers: ["claude"] });
    writeFileSync(
      file,
      [
        claudeEvent(),
        claudeEvent({ uuid: "evt-2", usage: { input_tokens: 10, output_tokens: 5 } }),
        claudeEvent({ uuid: "evt-3", usage: { input_tokens: 7, output_tokens: 3 } }),
      ].join("\n") + "\n",
    );
    const second = collectProvidersSync(store, { providers: ["claude"] });
    assert.equal(second.usage.length, 2, "only new events are ingested");
    assert.equal(store.listExternalUsage("claude").length, 3);
  });

  it("timeboxes huge or slow sources", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    const file = join(claudeDir, "projects", "p1", "huge.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 50_000; i++) {
      lines.push(claudeEvent({ uuid: `bulk-${i}`, usage: { input_tokens: 1, output_tokens: 1 } }));
    }
    writeFileSync(file, lines.join("\n") + "\n");

    const out = collectClaude(store, 1, settings);
    assert.equal(out.result.status, "timeboxed");
    assert.ok(out.result.eventsIngested < 50_000);
  });

  it("reads plan limits from claude.json only with credentials consent", () => {
    setConsent(store, "claude", "credentials", false);
    const without = collectClaude(store, 2000, settings);
    assert.deepEqual(without.limits, []);

    writeFileSync(
      join(claudeDir, "claude.json"),
      JSON.stringify({ usage: { plan: "max", given: 1_000_000, used: 400_000, period_end: "2026-08-10T00:00:00.000Z" } }),
    );
    const stillWithout = collectClaude(store, 2000, settings);
    assert.deepEqual(stillWithout.limits, []);

    setConsent(store, "claude", "credentials", true);
    const withConsent = collectClaude(store, 2000, settings);
    assert.equal(withConsent.limits.length, 1);
    const limit = withConsent.limits[0];
    assert.equal(limit.plan, "max");
    assert.equal(limit.usedPercent, 40);
    assert.equal(limit.creditsTotal, 1_000_000);
    assert.equal(limit.resetAt, "2026-08-10T00:00:00.000Z");
    assert.equal(limit.source, "local");
  });

  it("reports missing data as unavailable rather than zero", () => {
    const saved = process.env.OPENAGENTHUB_CLAUDE_DIR;
    process.env.OPENAGENTHUB_CLAUDE_DIR = join(home, "does-not-exist");
    try {
      const out = collectClaude(store, 2000, settings);
      assert.equal(out.result.status, "missing");
      assert.equal(out.result.detected, false);
      assert.equal(out.usage.length, 0);
    } finally {
      process.env.OPENAGENTHUB_CLAUDE_DIR = saved;
    }
  });
});

describe("codex adapter", () => {
  it("treats summary totals as cumulative and prevents duplicate counting", () => {
    mkdirSync(join(codexDir, "sessions", "2026-08-01"), { recursive: true });
    const file = join(codexDir, "sessions", "2026-08-01", "session-a.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "message", id: "m1", model: "gpt-5", payload: { usage: { input_tokens: 100, output_tokens: 50 } } }),
        JSON.stringify({ type: "summary", id: "s1", payload: { totals: { model: "gpt-5", input_tokens: 100, output_tokens: 50 } } }),
        JSON.stringify({ type: "message", id: "m2", payload: { usage: { input_tokens: 20, output_tokens: 10 } } }),
        JSON.stringify({ type: "summary", id: "s2", payload: { totals: { model: "gpt-5", input_tokens: 300, output_tokens: 150 } } }),
        JSON.stringify({ type: "ratelimit", payload: { limit: 1000, remaining: 700, reset_after: 300, units: "requests" } }),
      ].join("\n") + "\n",
    );

    const first = collectCodex(store, 2000, settings);
    assert.equal(first.result.status, "ok");
    assert.equal(first.usage.length, 4);
    const delta = first.usage.filter((u) => u.eventKey.startsWith("cum"));
    assert.equal(delta.length, 2);
    assert.equal(delta[0].tokensIn, 100, "first cumulative total is the full amount");
    assert.equal(delta[1].tokensIn, 200, "second cumulative total is the delta");
    assert.equal(first.limits.length, 1);
    assert.equal(first.limits[0].creditsTotal, 1000);
    assert.equal(first.limits[0].creditsUsed, 300);

    const second = collectCodex(store, 2000, settings);
    assert.equal(second.usage.length, 0, "repeated parsing must not duplicate usage");
  });

  it("does not duplicate when cumulative totals are re-read after replacement", () => {
    mkdirSync(join(codexDir, "sessions", "2026-08-01"), { recursive: true });
    const file = join(codexDir, "sessions", "2026-08-01", "session-a.jsonl");
    writeFileSync(file, JSON.stringify({ type: "summary", id: "s1", payload: { totals: { model: "gpt-5", input_tokens: 100, output_tokens: 50 } } }) + "\n");
    collectCodex(store, 2000, settings);

    writeFileSync(
      file,
      [
        JSON.stringify({ type: "summary", id: "s1", payload: { totals: { model: "gpt-5", input_tokens: 100, output_tokens: 50 } } }),
        JSON.stringify({ type: "summary", id: "s2", payload: { totals: { model: "gpt-5", input_tokens: 260, output_tokens: 130 } } }),
      ].join("\n") + "\n",
    );
    const second = collectCodex(store, 2000, settings);
    assert.equal(second.usage.length, 1);
    assert.equal(second.usage[0].tokensIn, 160);
  });

  it("treats missing rate-limit records as unavailable, not zero", () => {
    mkdirSync(join(codexDir, "sessions", "2026-08-01"), { recursive: true });
    const file = join(codexDir, "sessions", "2026-08-01", "session-a.jsonl");
    writeFileSync(file, JSON.stringify({ type: "message", id: "m1", payload: { usage: { input_tokens: 5, output_tokens: 2 } } }) + "\n");
    const out = collectCodex(store, 2000, settings);
    assert.equal(out.usage.length, 1);
    assert.equal(out.limits.length, 0, "missing rate limit must not fabricate a zero limit");
  });

  it("ignores malformed lines and unsupported shapes", () => {
    mkdirSync(join(codexDir, "sessions", "2026-08-01"), { recursive: true });
    const file = join(codexDir, "sessions", "2026-08-01", "session-a.jsonl");
    writeFileSync(file, ["garbage", JSON.stringify({ type: "message", id: "m1", payload: { usage: { input_tokens: 4, output_tokens: 1 } } }), JSON.stringify({ type: "unknown" })].join("\n") + "\n");
    const out = collectCodex(store, 2000, settings);
    assert.equal(out.usage.length, 1);
    assert.ok(out.result.eventsSkipped >= 2);
  });
});

describe("opencode adapter", () => {
  function buildDb(path: string, rows: Array<Record<string, unknown>>): void {
    const db = new DatabaseSync(path);
    db.exec("DROP TABLE IF EXISTS messages");
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, modelID TEXT, tokens TEXT, cost REAL, time INTEGER)");
    const insert = db.prepare("INSERT INTO messages (session_id, modelID, tokens, cost, time) VALUES (?, ?, ?, ?, ?)");
    for (const row of rows) {
      insert.run(row.session_id, row.modelID, typeof row.tokens === "string" ? row.tokens : JSON.stringify(row.tokens), row.cost ?? null, row.time);
    }
    db.close();
  }

  it("reads token usage from the messages table read-only", () => {
    const dbPath2 = join(opencodeDir, "storage", "proj-a", "storage.sqlite");
    mkdirSync(join(opencodeDir, "storage", "proj-a"), { recursive: true });
    buildDb(dbPath2, [
      { session_id: "s1", modelID: "gpt-4o", tokens: { input: 100, output: 50 }, cost: 0.01, time: 1_752_500_000_000 },
      { session_id: "s1", modelID: "gpt-4o", tokens: "30, 12", time: 1_752_500_010_000 },
      { session_id: "s2", modelID: "claude-sonnet-4", tokens: 7, time: 1_752_500_020_000 },
    ]);

    const out = collectOpencode(store, 2000, settings);
    assert.equal(out.result.status, "ok");
    assert.equal(out.usage.length, 3);
    assert.equal(out.usage[0].tokensIn, 100);
    assert.equal(out.usage[0].tokensOut, 50);
    assert.equal(out.usage[0].costExact, 0.01);
    assert.equal(out.usage[1].tokensIn, 30);
    assert.equal(out.usage[1].tokensOut, 12);
    assert.equal(out.usage[2].tokensOut, 7);

    const second = collectOpencode(store, 2000, settings);
    assert.equal(second.usage.length, 0, "unchanged database must not be re-read");

    buildDb(dbPath2, [
      { session_id: "s1", modelID: "gpt-4o", tokens: { input: 100, output: 50 }, cost: 0.01, time: 1_752_500_000_000 },
      { session_id: "s1", modelID: "gpt-4o", tokens: "30, 12", time: 1_752_500_010_000 },
      { session_id: "s2", modelID: "claude-sonnet-4", tokens: 7, time: 1_752_500_020_000 },
      { session_id: "s3", modelID: "gpt-4o", tokens: { input: 55, output: 20 }, time: 1_752_500_030_000 },
    ]);
    const third = collectOpencode(store, 2000, settings);
    assert.equal(third.usage.length, 1, "only rows newer than the cursor are read");
    assert.equal(third.usage[0].tokensIn, 55);
  });

  it("reports unsupported schemas instead of failing", () => {
    const dbPath2 = join(opencodeDir, "storage", "proj-b", "storage.sqlite");
    mkdirSync(join(opencodeDir, "storage", "proj-b"), { recursive: true });
    const db = new DatabaseSync(dbPath2);
    db.exec("CREATE TABLE weird (id INTEGER PRIMARY KEY, blob TEXT)");
    db.close();

    const out = collectOpencode(store, 2000, settings);
    assert.equal(out.result.status, "unsupported");
    assert.equal(out.usage.length, 0);
  });

  it("reports locked databases without blocking collection", () => {
    const dbPath2 = join(opencodeDir, "storage", "proj-c", "storage.sqlite");
    mkdirSync(join(opencodeDir, "storage", "proj-c"), { recursive: true });
    buildDb(dbPath2, [{ session_id: "s1", modelID: "gpt-4o", tokens: { input: 1, output: 1 }, time: 1_752_500_000_000 }]);
    const locker = new DatabaseSync(dbPath2);
    locker.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;");
    try {
      const out = collectOpencode(store, 2000, settings);
      assert.ok(["locked", "error", "ok"].includes(out.result.status));
      assert.equal(out.usage.length, 0);
    } finally {
      locker.exec("ROLLBACK;");
      locker.close();
    }
  });

  it("reads usage when the time column is created_at instead of time", () => {
    const dbPath2 = join(opencodeDir, "storage", "proj-d", "storage.sqlite");
    mkdirSync(join(opencodeDir, "storage", "proj-d"), { recursive: true });
    const db = new DatabaseSync(dbPath2);
    db.exec(
      "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, modelID TEXT, tokens TEXT, created_at INTEGER)",
    );
    db.prepare("INSERT INTO messages (session_id, modelID, tokens, created_at) VALUES (?, ?, ?, ?)").run(
      "s1",
      "gpt-4o",
      JSON.stringify({ input: 9, output: 3 }),
      1_752_500_000_000,
    );
    db.close();

    const first = collectOpencode(store, 2000, settings);
    assert.equal(first.result.status, "ok");
    assert.equal(first.usage.length, 1);
    assert.equal(first.usage[0].tokensIn, 9);
    assert.equal(first.usage[0].tokensOut, 3);

    const second = collectOpencode(store, 2000, settings);
    assert.equal(second.usage.length, 0, "cursor on created_at must not re-read");
  });
});

describe("collection orchestration", () => {
  it("collects all providers and persists normalized usage and limits", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    writeFileSync(join(claudeDir, "projects", "p1", "s.jsonl"), claudeEvent() + "\n");
    mkdirSync(join(codexDir, "sessions", "2026-08-01"), { recursive: true });
    writeFileSync(join(codexDir, "sessions", "2026-08-01", "s.jsonl"), JSON.stringify({ type: "message", id: "m1", payload: { usage: { input_tokens: 8, output_tokens: 4 } } }) + "\n");
    const opencodeDb = join(opencodeDir, "storage", "p", "storage.sqlite");
    mkdirSync(join(opencodeDir, "storage", "p"), { recursive: true });
    const db = new DatabaseSync(opencodeDb);
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, modelID TEXT, tokens TEXT, cost REAL, time INTEGER)");
    db.prepare("INSERT INTO messages (session_id, modelID, tokens, time) VALUES (?, ?, ?, ?)").run("s1", "gpt-4o", JSON.stringify({ input: 3, output: 2 }), 1_752_500_000_000);
    db.close();

    const result = collectProvidersSync(store, { providers: ["claude", "codex", "opencode"] });
    assert.equal(result.providers.length, 3);
    assert.ok(result.providers.every((p) => p.status === "ok"), JSON.stringify(result.providers));

    const overview = providerUsageOverview(store);
    assert.equal(overview.length, 3);
    const claude = overview.find((p) => p.provider === "claude");
    assert.equal(claude?.events, 1);
    assert.equal(claude?.tokensIn, 100);

    const again = collectProvidersSync(store, { providers: ["claude", "codex", "opencode"] });
    assert.equal(again.usage.length, 0, "no duplicates on repeated collection");
  });

  it("honors per-provider disable", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    writeFileSync(join(claudeDir, "projects", "p1", "s.jsonl"), claudeEvent() + "\n");
    setEnabled(store, "claude", false);
    const out = collectProvidersSync(store, { providers: ["claude"] });
    assert.equal(out.providers[0].status, "disabled");
    assert.equal(store.listExternalUsage("claude").length, 0);
  });

  it("refuses local parsing without credentials consent", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    writeFileSync(join(claudeDir, "projects", "p1", "s.jsonl"), claudeEvent() + "\n");
    setConsent(store, "claude", "credentials", false);
    const out = collectProvidersSync(store, { providers: ["claude"] });
    assert.equal(out.providers[0].status, "disabled");
    assert.match(out.providers[0].message ?? "", /consent not granted/);
    assert.equal(out.usage.length, 0);
    assert.equal(store.listExternalUsage("claude").length, 0);
  });

  it("revoking a provider clears its usage and consent", () => {
    mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
    writeFileSync(join(claudeDir, "projects", "p1", "s.jsonl"), claudeEvent() + "\n");
    setConsent(store, "claude", "credentials", true);
    setConsent(store, "claude", "live", true);
    collectProvidersSync(store, { providers: ["claude"] });
    assert.equal(store.listExternalUsage("claude").length, 1);

    const removed = revokeProvider(store, "claude");
    assert.equal(removed.usage, 1);
    assert.equal(store.listExternalUsage("claude").length, 0);
    assert.equal(store.getSetting("integration.claude.credentials"), "0");
    assert.equal(store.getSetting("integration.claude.live"), "0");
  });

  it("stores manual limits and never fabricates zeros for missing windows", () => {
    setManualLimit(store, { provider: "codex", window: "weekly", plan: "pro", usedPercent: 45, units: "input_tokens" });
    const limits = store.listLimits("codex");
    assert.equal(limits.length, 1);
    assert.equal(limits[0].source, "manual");
    assert.equal(limits[0].usedPercent, 45);
  });
});

describe("live integration consent", () => {
  it("requires explicit live consent and an API key", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return {
        ok: true,
        json: async () => ({
          data: [{ start_time: 1_752_494_400, results: [{ input_tokens: 10, output_tokens: 20, num_model_requests: 3 }] }],
        }),
      };
    };
    const withoutConsent = await fetchLiveLimits("codex", { apiKey: "sk-test", fetchFn });
    assert.equal(withoutConsent.length, 1);
    assert.equal(called, true);

    const withoutKey = await fetchLiveLimits("codex", { apiKey: undefined, fetchFn });
    assert.equal(withoutKey.length, 0);

    const failure = await fetchLiveLimits("codex", {
      apiKey: "sk-test",
      fetchFn: async () => {
        throw new Error("network");
      },
    });
    assert.deepEqual(failure, [], "network failures fall back gracefully");
  });

  it("gates unofficial anthropic usage behind the experimental flag", async () => {
    const fetchFn = async () => ({ ok: true, json: async () => ({ plan: "pro", given: 1_000_000, used: 200_000, period_end: "2026-08-10T00:00:00.000Z" }) });
    delete process.env.OPENAGENTHUB_EXPERIMENTAL;
    const off = await fetchLiveLimits("claude", { apiKey: "sk-ant", fetchFn });
    assert.deepEqual(off, [], "unofficial endpoint must be feature-flagged");

    process.env.OPENAGENTHUB_EXPERIMENTAL = "1";
    const on = await fetchLiveLimits("claude", { apiKey: "sk-ant", fetchFn });
    assert.equal(on.length, 1);
    assert.equal(on[0].plan, "pro");
    assert.equal(on[0].usedPercent, 20);
    delete process.env.OPENAGENTHUB_EXPERIMENTAL;
  });

  it("upserts live limits into the store only through the consent-gated path", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return { ok: true, json: async () => ({ data: [{ start_time: 1_752_494_400, results: [{ input_tokens: 10, output_tokens: 20 }] }] }) };
    };
    const limits = await fetchLiveLimits("codex", { apiKey: "sk-test", fetchFn });
    assert.equal(limits.length, 1);
    assert.equal(called, true);
    assert.equal(limits[0].source, "live");
  });
});
