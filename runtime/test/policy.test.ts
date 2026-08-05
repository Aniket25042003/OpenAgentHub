import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveSandbox, type SandboxOverride } from "../dist/sandbox/policy.js";
import { effectivePermissions, unsupportedSavedGrants } from "../dist/permissions.js";

const manifest = (overrides: Record<string, unknown> = {}) =>
  ({
    name: "acme/echo",
    version: "1.0.0",
    runtime: { language: "python" },
    interfaces: { cli: { command: "python app.py" } },
    permissions: ["network", "filesystem"],
    ...overrides,
  }) as never;

const override: SandboxOverride = { sandbox: "container", digest: "abc123", setAt: "2026-01-01T00:00:00Z" };

test("blocked review status fails closed", () => {
  const d = effectiveSandbox({ trust: "trusted", manifest: manifest(), reviewStatus: "revoked" });
  assert.ok(d.blocked);
  assert.match(d.blocked!, /revoked/);
});

test("untrusted source always runs in container even with process override", () => {
  const d = effectiveSandbox({
    trust: "untrusted",
    manifest: manifest(),
    reviewStatus: "verified",
    override: { ...override, sandbox: "process" },
  });
  assert.equal(d.mode, "container");
});

test("stale non-verified status forces container", () => {
  const d = effectiveSandbox({ trust: "trusted", manifest: manifest(), reviewStatus: "pending", statusFresh: false });
  assert.equal(d.mode, "container");
});

test("fresh verified status allows manifest-requested isolated-process", () => {
  const d = effectiveSandbox({
    trust: "trusted",
    manifest: manifest({ runtime: { language: "python", sandbox: "isolated-process" } }),
    reviewStatus: "verified",
    statusFresh: true,
  });
  assert.equal(d.mode, "process");
});

test("container override applies when digest matches", () => {
  const d = effectiveSandbox({
    trust: "trusted",
    manifest: manifest(),
    reviewStatus: "verified",
    statusFresh: true,
    override,
    archiveDigest: "abc123",
  });
  assert.equal(d.mode, "container");
  assert.equal(d.overrideApplied, true);
});

test("stale override (digest mismatch) falls back to container", () => {
  const d = effectiveSandbox({
    trust: "trusted",
    manifest: manifest(),
    reviewStatus: "verified",
    statusFresh: true,
    override,
    archiveDigest: "newdigest",
  });
  assert.equal(d.mode, "container");
  assert.match(d.reason, /stale/);
});

test("process override honored for trusted agent with matching digest", () => {
  const d = effectiveSandbox({
    trust: "trusted",
    manifest: manifest(),
    reviewStatus: "verified",
    statusFresh: true,
    override: { ...override, sandbox: "process" },
    archiveDigest: "abc123",
  });
  assert.equal(d.mode, "process");
});

test("unknown trust with no status runs in container", () => {
  const d = effectiveSandbox({ trust: "unknown", manifest: manifest() });
  assert.equal(d.mode, "container");
});

test("effectivePermissions intersect saved grants with manifest requests", () => {
  const saved = { network: true, terminal: true, filesystem: false };
  const effective = effectivePermissions(manifest(), saved);
  assert.deepEqual(effective, ["network"]);
});

test("unsupportedSavedGrants lists tampered grants", () => {
  const saved = { terminal: true, network: true };
  assert.deepEqual(unsupportedSavedGrants(manifest(), saved), ["terminal"]);
});

test("none permission list yields no effective grants", () => {
  const m = manifest({ permissions: ["none"] });
  assert.deepEqual(effectivePermissions(m, { none: true, network: true }), []);
});
