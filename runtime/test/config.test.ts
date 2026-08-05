import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
let loadConfig: () => Record<string, unknown>;
let saveConfig: (c: Record<string, unknown>) => void;
let recordInstall: (c: Record<string, unknown>, a: Record<string, unknown>) => void;
let ConfigCorruptError: new (m: string) => Error;

before(async () => {
  home = mkdtempSync(join(tmpdir(), "oah-cfg-"));
  process.env.AGENT_HOME = home;
  const mod = await import("../dist/index.js");
  loadConfig = mod.loadConfig;
  saveConfig = mod.saveConfig;
  recordInstall = mod.recordInstall;
  ConfigCorruptError = mod.ConfigCorruptError;
});

describe("config", () => {
  it("returns {} when config.json is absent", () => {
    assert.deepEqual(loadConfig(), {});
  });

  it("round-trips config and writes it atomically", () => {
    recordInstall(loadConfig() as never, {
      namespace: "acme",
      name: "hello",
      version: "1.0.0",
      author: "x",
      trust: "unknown",
      installedAt: new Date().toISOString(),
      source: "test",
    } as never);
    const reloaded = loadConfig() as { installed?: Record<string, unknown> };
    assert.ok(reloaded.installed?.["acme/hello@1.0.0"]);
    const parsed = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    assert.ok(parsed.installed);
  });

  it("throws ConfigCorruptError on invalid JSON, never silently empty", () => {
    const configPath = join(home, "config.json");
    const original = readFileSync(configPath, "utf8");
    writeFileSync(configPath, "{ not json");
    assert.throws(() => loadConfig(), ConfigCorruptError);
    try {
      loadConfig();
      assert.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      assert.match(msg, /not valid JSON/);
      assert.match(msg, /recovery/);
      assert.ok(msg.includes("config.json"));
    }
    assert.equal(readFileSync(configPath, "utf8"), "{ not json");
    writeFileSync(configPath, original);
  });
});
