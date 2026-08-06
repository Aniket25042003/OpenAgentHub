import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const home = mkdtempSync(join(tmpdir(), "oah-cp-"));
process.env.AGENT_HOME = home;
const m = await import("../src/lib/control-plane.ts");

after(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.AGENT_HOME;
});

describe("control-plane state", () => {
  it("round-trips state atomically", () => {
    const state = { pid: 123, startIdentity: "s", port: 31777, productVersion: "0.1.0", protocolVersion: 1, startedAt: "now", health: "ready" as const };
    m.writeState(state);
    assert.deepEqual(m.readState(), state);
    const stat = statSync(m.controlInfo().statePath);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it("returns null for missing or corrupt state", () => {
    m.clearState();
    assert.equal(m.readState(), null);
    writeFileSync(m.controlInfo().statePath, "{ not json");
    assert.equal(m.readState(), null);
  });

  it("token is generated once and stored with restrictive permissions", () => {
    const t1 = m.readToken();
    const t2 = m.readToken();
    assert.equal(t1, t2);
    assert.ok(t1.length >= 32);
    const stat = statSync(m.controlInfo().tokenPath);
    assert.equal(stat.mode & 0o777, 0o600);
  });
});

describe("control-plane locking", () => {
  it("exclusive lock: second acquisition fails while held", () => {
    assert.equal(m.acquireLock(), true);
    assert.equal(m.lockOwnerPid(), process.pid);
    assert.equal(m.acquireLock(), false);
    m.releaseLock();
    assert.equal(m.acquireLock(), true);
    m.releaseLock();
  });

  it("stale lock owned by a dead pid is reclaimed", () => {
    m.acquireLock();
    writeFileSync(join(m.controlInfo().dir, "lock", "owner"), "999999999");
    assert.equal(m.acquireLock(), true);
    m.releaseLock();
  });
});

describe("control-plane identity", () => {
  it("matches the running process identity", () => {
    const stamp = m.processStartStamp(process.pid);
    assert.ok(stamp);
    assert.equal(m.identityMatches({ pid: process.pid, startIdentity: stamp!, port: 1, productVersion: "0.1.0", protocolVersion: 1, startedAt: "now", health: "ready" }), true);
    assert.equal(m.identityMatches({ pid: process.pid, startIdentity: "bogus", port: 1, productVersion: "0.1.0", protocolVersion: 1, startedAt: "now", health: "ready" }), false);
    assert.equal(m.identityMatches({ pid: 999999999, startIdentity: stamp!, port: 1, productVersion: "0.1.0", protocolVersion: 1, startedAt: "now", health: "ready" }), false);
  });

  it("isProcessAlive reflects liveness", () => {
    assert.equal(m.isProcessAlive(process.pid), true);
    assert.equal(m.isProcessAlive(999999999), false);
  });

  it("daemonNeedsRestart on protocol or product version change", () => {
    const base = { pid: 1, startIdentity: "s", port: 1, productVersion: m.productVersion(), protocolVersion: 1, startedAt: "now", health: "ready" as const };
    assert.equal(m.daemonNeedsRestart(base), false);
    assert.equal(m.daemonNeedsRestart({ ...base, protocolVersion: 0 }), true);
    assert.equal(m.daemonNeedsRestart({ ...base, productVersion: "9.9.9" }), true);
  });
});

describe("control-plane port selection", () => {
  it("prefers the requested port", async () => {
    assert.equal(await m.selectPort(31998), 31998);
  });

  it("selects an alternate port on collision", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(31997, "127.0.0.1", resolve));
    try {
      const port = await m.selectPort(31997);
      assert.notEqual(port, 31997);
      assert.ok(port > 31997);
    } finally {
      blocker.close();
    }
  });
});

describe("control-plane logs", () => {
  it("rotates an oversized log and keeps the newest files", () => {
    const logPath = m.controlInfo().logPath;
    mkdirSync(m.controlInfo().dir, { recursive: true });
    const line = "x".repeat(600_000) + "\n";
    writeFileSync(logPath, line.repeat(10));
    m.rotateLogs();
    assert.ok(existsSync(`${logPath}.1`));
    const files = m.logFilenames();
    assert.ok(files.length <= 3);
    assert.equal(files[0], `${logPath}.1`);
    const tail = m.readLogTail(3);
    assert.equal(tail.split("\n").length, 3);
    assert.ok(tail.trimEnd().endsWith("x"));
  });

  it("tail keeps empty log safe", () => {
    const logPath = m.controlInfo().logPath;
    for (const f of m.logFilenames()) rmSync(f, { force: true });
    writeFileSync(logPath, "");
    assert.equal(m.readLogTail(10), "");
  });

  it("tail honors the line budget across a trailing newline and truncation", () => {
    const logPath = m.controlInfo().logPath;
    for (const f of m.logFilenames()) rmSync(f, { force: true });
    writeFileSync(logPath, "1\n2\n3\n4\n5\n");
    assert.equal(m.readLogTail(3), "3\n4\n5");
    writeFileSync(logPath, "1\n2\n3\n4\n5");
    assert.equal(m.readLogTail(3), "3\n4\n5");
  });

  it("follow resets offset when the log is rotated to a larger file", () => {
    const logPath = m.controlInfo().logPath;
    writeFileSync(logPath, "a".repeat(200));
    const initial = m.initLogFollow(logPath);
    assert.equal(initial.offset, 200);
    assert.equal(m.readLogFollow(logPath, initial).line, null);
    rmSync(logPath, { force: true });
    writeFileSync(logPath, "b".repeat(400));
    const rotated = m.readLogFollow(logPath, initial);
    assert.equal(rotated.line, "b".repeat(400));
    assert.equal(rotated.next.offset, 400);
    assert.notEqual(rotated.next.identity, initial.identity);
  });

  it("follow reads appended bytes and honors the read budget", () => {
    const logPath = m.controlInfo().logPath;
    writeFileSync(logPath, "a".repeat(100));
    const initial = m.initLogFollow(logPath);
    writeFileSync(logPath, "a".repeat(100) + "b".repeat(30));
    const appended = m.readLogFollow(logPath, initial);
    assert.equal(appended.line, "b".repeat(30));
    assert.equal(appended.next.offset, 130);
  });
});

describe("control-plane readiness and ports", () => {
  it("waitForReadyState returns null on timeout while still starting", async () => {
    m.clearState();
    m.writeState({ pid: 123, startIdentity: "s", port: 31996, productVersion: "0.1.0", protocolVersion: 1, startedAt: "now", health: "starting" as const });
    assert.equal(await m.waitForReadyState(150), null);
    m.writeState({ pid: 123, startIdentity: "s", port: 31996, productVersion: "0.1.0", protocolVersion: 1, startedAt: "now", health: "stopped" as const });
    assert.equal(await m.waitForReadyState(150), null);
    m.writeState({ pid: 123, startIdentity: "s", port: 31996, productVersion: "0.1.0", protocolVersion: 1, startedAt: "now", health: "ready" as const });
    assert.equal((await m.waitForReadyState(1500))?.health, "ready");
  });

  it("accepts ports in 1..65535 only", () => {
    for (const bad of [0, -1, 65536, 1.5, NaN, Infinity]) assert.equal(m.validPort(bad), false);
    for (const good of [1, 1024, 65535]) assert.equal(m.validPort(good), true);
  });
});

describe("control-plane daemon integration", () => {
  const noDaemon = process.env.OPENAGENTHUB_NO_DAEMON;
  const dashboardPath = join(import.meta.dirname, "..", "dashboard", "server.js");

  it("spawns one daemon concurrently and stops it safely", async (t) => {
    if (!existsSync(dashboardPath) || noDaemon === "1") return t.skip("dashboard build unavailable");
    const [a, b] = await Promise.all([m.ensureDaemon(), m.ensureDaemon()]);
    assert.equal(a.state.pid, b.state.pid);
    assert.equal(a.state.health, "ready");
    assert.equal([a.started, b.started].filter(Boolean).length, 1);
    const health = await m.fetchControl<{ status: string }>(a.state.port, "/api/local/v1/health");
    assert.equal(health?.status, "ok");
    assert.equal((await m.stopDaemon()).outcome, "stopped");
    const after = m.readState();
    assert.ok(!after || after.health === "stopped");
    assert.equal(m.isProcessAlive(a.state.pid), false);
  });

  it("restarts a live daemon whose protocol version is stale", async (t) => {
    if (!existsSync(dashboardPath) || noDaemon === "1") return t.skip("dashboard build unavailable");
    const first = await m.ensureDaemon();
    const statePath = m.controlInfo().statePath;
    const stale = JSON.parse(readFileSync(statePath, "utf8"));
    stale.protocolVersion = 0;
    writeFileSync(statePath, JSON.stringify(stale));
    const second = await m.ensureDaemon();
    assert.equal(second.started, true);
    assert.equal(second.state.protocolVersion, 1);
    assert.notEqual(second.state.pid, first.state.pid);
    assert.equal((await m.stopDaemon()).outcome, "stopped");
  });
});
