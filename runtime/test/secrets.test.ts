import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretsVault, VaultCorruptError, machineId } from "../dist/index.js";

describe("secrets vault", () => {
  it("round-trips secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-sec-"));
    const vault = SecretsVault.open({ dir, passphrase: "test-pass" });
    const key = "github/pr-reviewer@1.0.0";
    assert.equal(vault.has(key), false);
    vault.set(key, { GITHUB_TOKEN: "tok123", OPENAI_API_KEY: "sk-xyz" });
    assert.equal(vault.has(key), true);
    const got = vault.get(key);
    assert.equal(got.GITHUB_TOKEN, "tok123");
    assert.equal(got.OPENAI_API_KEY, "sk-xyz");
    vault.delete(key);
    assert.equal(vault.has(key), false);
  });

  it("missing secrets return {} but a wrong key throws VaultCorruptError", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-sec-"));
    const key = "acme/hello@1.0.0";
    SecretsVault.open({ dir, passphrase: "correct" }).set(key, { SECRET: "value" });
    const wrong = SecretsVault.open({ dir, passphrase: "wrong" });
    assert.deepEqual(wrong.get("acme/other@1.0.0"), {});
    assert.throws(() => wrong.get(key), VaultCorruptError);
    assert.throws(() => wrong.get(key), /master key|unrecoverable/);
  });

  it("throws VaultCorruptError for a corrupt secret file instead of returning empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-sec-"));
    const vault = SecretsVault.open({ dir, passphrase: "p" });
    const key = "acme/hello@1.0.0";
    vault.set(key, { SECRET: "value" });
    const file = readdirSync(dir).filter((f) => f.endsWith(".json"))[0];
    writeFileSync(join(dir, file), "not-a-blob");
    assert.throws(() => vault.get(key), VaultCorruptError);
    assert.throws(() => vault.get(key), /master key|unrecoverable/);
  });

  it("writes secret files atomically (no leftover temp files)", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-sec-"));
    const vault = SecretsVault.open({ dir, passphrase: "p" });
    for (let i = 0; i < 5; i++) vault.set("acme/hello@1.0.0", { N: `v${i}` });
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
    assert.equal(vault.get("acme/hello@1.0.0").N, "v4");
  });

  it("empty secret values delete the key", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-sec-"));
    const vault = SecretsVault.open({ dir, passphrase: "p" });
    vault.set("x/y@1.0.0", { A: "1", B: "2" });
    vault.set("x/y@1.0.0", { B: "" });
    assert.deepEqual(vault.get("x/y@1.0.0"), { A: "1" });
  });

  it("encrypted file does not contain plaintext", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-sec-"));
    const vault = SecretsVault.open({ dir, passphrase: "p" });
    vault.set("x/y@1.0.0", { GITHUB_TOKEN: "super-secret-token-value" });
    const files = [];
    for (const f of vault.list()) files.push(readFileSync(join(dir, f), "utf8"));
    assert.ok(!files.some((c) => c.includes("super-secret-token-value")));
  });

  it("machine id is stable", () => {
    assert.equal(machineId(), machineId());
  });
});
