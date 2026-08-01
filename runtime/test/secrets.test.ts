import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretsVault, machineId } from "../dist/index.js";

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

  it("cannot decrypt with the wrong passphrase", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-sec-"));
    const key = "acme/hello@1.0.0";
    SecretsVault.open({ dir, passphrase: "correct" }).set(key, { SECRET: "value" });
    const wrong = SecretsVault.open({ dir, passphrase: "wrong" });
    assert.deepEqual(wrong.get(key), {});
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
