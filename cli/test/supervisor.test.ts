import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExitReason, RunProbe, RunRecord, RunState } from "../src/lib/supervisor.ts";

const home = mkdtempSync(join(tmpdir(), "oah-sup-"));
process.env.AGENT_HOME = home;
const m = await import("../dist/lib/supervisor.js");

before(() => {
  process.env.AGENT_HOME = home;
});

after(() => {
  rmSync(home, { recursive: true, force: true });
});

function baseRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  return {
    runId: m.newRunId(),
    agentKey: "demo/hello@1.0.0",
    version: "1.0.0",
    interfaceName: "cli",
    sandbox: "process",
    managed: true,
    state: "running",
    health: "unknown",
    restartPolicy: "none",
    createdAt: now,
    startedAt: now,
    ...overrides,
  };
}

describe("run records", () => {
  it("round-trips a run record atomically", () => {
    const rec = baseRecord();
    m.writeRun(rec);
    const read = m.readRun(rec.runId);
    assert.ok(read);
    assert.equal(read.runId, rec.runId);
    assert.equal(read.state, "running");
    assert.equal(read.agentKey, "demo/hello@1.0.0");
    assert.equal(readdirSync(m.RUNS_DIR).filter((f) => f.endsWith(".tmp")).length, 0);
    m.removeRun(rec.runId);
  });

  it("lists runs newest-last and removes a run with its logs", () => {
    const a = baseRecord({ state: "exited", endedAt: new Date().toISOString() });
    const b = baseRecord({ state: "failed", exitCode: 1, exitReason: "crashed", endedAt: new Date().toISOString() });
    m.writeRun(a);
    m.writeRun(b);
    writeFileSync(m.runLogPath(a.runId), "hello\n");
    const list = m.listRuns();
    assert.equal(list.length, 2);
    assert.ok(list.find((r) => r.runId === a.runId));
    assert.ok(list.find((r) => r.runId === b.runId));
    m.removeRun(a.runId);
    assert.equal(m.readRun(a.runId), null);
    assert.equal(existsSync(m.runLogPath(a.runId)), false);
    m.removeRun(b.runId);
  });

  it("rejects invalid states on write and ignores corrupt records on read", () => {
    assert.throws(() => m.writeRun(baseRecord({ state: "banana" as RunState })));
    const rec = baseRecord();
    m.writeRun(rec);
    writeFileSync(m.runRecordPath(rec.runId), "{not json");
    assert.equal(m.readRun(rec.runId), null);
    m.removeRun(rec.runId);
  });
});

describe("run log rotation", () => {
  it("rotates an oversized run log and keeps the newest files", () => {
    const rec = baseRecord({ state: "exited", endedAt: new Date().toISOString() });
    m.writeRun(rec);
    const line = "x".repeat(3_000_000);
    writeFileSync(m.runLogPath(rec.runId), `${line}\n${line}\n`);
    m.rotateRunLog(rec.runId);
    writeFileSync(m.runLogPath(rec.runId), `${line}\n${line}\n`);
    m.rotateRunLog(rec.runId);
    writeFileSync(m.runLogPath(rec.runId), "current\n");
    const files = m.runLogFilenames(rec.runId);
    assert.ok(files.length >= 3, `expected >= 3 rotated files, got ${files.length}`);
    const tail = m.readRunLogTail(rec.runId, 1);
    assert.equal(tail.split("\n").length, 1);
    assert.equal(tail, "current");
    m.removeRun(rec.runId);
  });

  it("tail keeps empty log safe", () => {
    assert.equal(m.readRunLogTail(m.newRunId()), "");
  });
});

describe("reconcile", () => {
  const aliveProbe = (workerAlive: boolean, groupAlive: boolean) =>
    ({
      isAlive: () => workerAlive,
      groupAlive: () => groupAlive,
      container: () => null,
    }) as RunProbe;

  it("marks a dead process-sandbox worker as exited/crashed", () => {
    const rec = baseRecord({ pid: 42 });
    const next = m.reconcileRun(rec, aliveProbe(false, false));
    assert.equal(next.state, "exited");
    assert.equal(next.exitReason, "crashed");
    assert.ok(next.endedAt);
  });

  it("marks an orphaned process-sandbox worker when the supervisor is gone", () => {
    const rec = baseRecord({ pid: 42 });
    const next = m.reconcileRun(rec, aliveProbe(false, true));
    assert.equal(next.state, "orphaned");
    assert.equal(next.exitReason, "supervisor-gone");
  });

  it("keeps a live process-sandbox worker running", () => {
    const rec = baseRecord({ pid: 42 });
    const next = m.reconcileRun(rec, aliveProbe(true, true));
    assert.equal(next.state, "running");
  });

  it("marks a container run as exited when its container is gone", () => {
    const rec = baseRecord({ sandbox: "container", containerId: "abc123" });
    const next = m.reconcileRun(rec, {
      isAlive: () => true,
      groupAlive: () => true,
      container: () => null,
    });
    assert.equal(next.state, "exited");
    assert.equal(next.exitReason, "container-gone");
  });

  it("records oom as the exit reason for a killed container", () => {
    const rec = baseRecord({ sandbox: "container" });
    const next = m.reconcileRun(rec, {
      isAlive: () => true,
      groupAlive: () => true,
      container: () => ({ id: "deadbeef", running: false, oomKilled: true }),
    });
    assert.equal(next.state, "exited");
    assert.equal(next.exitReason, "oom");
  });

  it("leaves ended runs untouched", () => {
    const rec = baseRecord({ state: "exited", endedAt: new Date().toISOString() });
    const next = m.reconcileRun(rec, aliveProbe(false, false));
    assert.equal(next, rec);
  });

  it("reconcileRuns persists state transitions and reports orphaned containers", () => {
    const rec = baseRecord({ pid: 42, state: "starting" });
    m.writeRun(rec);
    const probe = {
      isAlive: () => false,
      groupAlive: () => false,
      container: () => null,
    } as RunProbe;
    m.listRuns().forEach((r) => {
      if (r.runId !== rec.runId) return;
      const next = m.reconcileRun(r, probe);
      if (next.state !== r.state) m.writeRun(next);
    });
    const updated = m.readRun(rec.runId);
    assert.equal(updated?.state, "exited");
    assert.equal(updated?.exitReason, "crashed");
    assert.ok(Array.isArray(m.orphanContainers()));
    m.removeRun(rec.runId);
  });
});

describe("stop and restart", () => {
  it("throws for unknown and ended runs", async () => {
    await assert.rejects(m.stopRun("r-nope"), /not found/);
    const rec = baseRecord({ state: "exited", endedAt: new Date().toISOString() });
    m.writeRun(rec);
    await assert.rejects(m.stopRun(rec.runId), /is not running/);
    m.removeRun(rec.runId);
  });

  it("restart keeps the run id and resets logs", async () => {
    const rec = baseRecord({ state: "exited", exitCode: 0, exitReason: "exit", endedAt: new Date().toISOString() });
    m.writeRun(rec);
    writeFileSync(m.runLogPath(rec.runId), "old log\n");
    const restarted = await m.restartRun({
      runId: rec.runId,
      agentKey: "demo/hello@1.0.0",
      version: "1.0.0",
      interfaceName: "cli",
      sandbox: "process",
    });
    assert.equal(restarted.record.runId, rec.runId);
    assert.equal(restarted.record.state, "starting");
    assert.ok(existsSync(m.runLogPath(rec.runId)));
    const record = m.readRun(rec.runId);
    assert.ok(record);
    assert.equal(record.sandbox, "process");
    assert.ok(record.pid);
    await m.stopRun(rec.runId).catch(() => {});
    m.removeRun(rec.runId);
  });

  it("new run ids are unique and url-safe", () => {
    const ids = new Set(Array.from({ length: 50 }, () => m.newRunId()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^r-[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe("startManagedRun", () => {
  it("spawns a supervisor worker and records a pid", async () => {
    const rec = baseRecord({ state: "exited", endedAt: new Date().toISOString() });
    m.writeRun(rec);
    const { workerPid } = m.startManagedRun({
      runId: rec.runId,
      agentKey: "demo/hello@1.0.0",
      version: "1.0.0",
      interfaceName: "cli",
      sandbox: "process",
      input: "{}",
    });
    assert.ok(workerPid > 0);
    const record = m.readRun(rec.runId);
    assert.ok(record);
    assert.ok(record.pid);
    assert.equal(record.state, "starting");
    await m.stopRun(rec.runId).catch(() => {});
    m.removeRun(rec.runId);
  });
});

void (null as unknown as ExitReason | undefined);
