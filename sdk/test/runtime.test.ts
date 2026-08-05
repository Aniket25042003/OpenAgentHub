import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, versionSatisfies, decideSandbox } from "../dist/index.js";
import type { Manifest } from "../dist/index.js";

describe("version comparison", () => {
  it("compares versions", () => {
    assert.equal(compareVersions("3.12.7", "3.12.6"), 1);
    assert.equal(compareVersions("3.11", "3.12"), -1);
    assert.equal(compareVersions("22.5.0", "22.5.0"), 0);
  });

  it("satisfies specifiers", () => {
    assert.equal(versionSatisfies("3.12.7", ">=3.11"), true);
    assert.equal(versionSatisfies("3.10.2", ">=3.11"), false);
    assert.equal(versionSatisfies("3.12.7", "<3.13"), true);
    assert.equal(versionSatisfies("22.6.0", ">=18"), true);
    assert.equal(versionSatisfies("v22.6.0", ">=18"), true);
  });
});

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    manifestVersion: 1,
    name: "x/y",
    version: "1.0.0",
    author: "a",
    description: "d",
    license: "MIT",
    runtime: { language: "python" },
    models: { supported: ["local"] },
    interfaces: { cli: { command: "python app.py" } },
    ...overrides,
  } as Manifest;
}

describe("sandbox decision", () => {
  it("forces container for untrusted agents", () => {
    const m = manifest();
    const r = decideSandbox(m, { docker: true } as never, "untrusted");
    assert.equal(r.mode, "container");
  });

  it("uses fast path for trusted agents", () => {
    const m = manifest();
    const r = decideSandbox(m, { docker: true } as never, "trusted");
    assert.equal(r.mode, "isolated-process");
  });

  it("defaults unknown to container", () => {
    const m = manifest();
    const r = decideSandbox(m, { docker: true } as never, "unknown");
    assert.equal(r.mode, "container");
  });

  it("honors manifest-requested container", () => {
    const m = manifest({ runtime: { language: "python", sandbox: "container" } });
    const r = decideSandbox(m, { docker: true } as never, "trusted");
    assert.equal(r.mode, "container");
  });

  it("ignores isolated-process request for untrusted agents (source trust first)", () => {
    const m = manifest({ runtime: { language: "python", sandbox: "isolated-process" } });
    const r = decideSandbox(m, { docker: true } as never, "untrusted");
    assert.equal(r.mode, "container");
  });

  it("honors isolated-process request only for trusted agents", () => {
    const m = manifest({ runtime: { language: "python", sandbox: "isolated-process" } });
    const r = decideSandbox(m, { docker: true } as never, "trusted");
    assert.equal(r.mode, "isolated-process");
  });
});
