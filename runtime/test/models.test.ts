import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickModel, ModelError, buildAgentEnv, SecretsVault } from "../dist/index.js";
import type { Manifest } from "@openagenthub/sdk";

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    manifestVersion: 1,
    name: "x/y",
    version: "1.0.0",
    author: "a",
    description: "d",
    license: "MIT",
    runtime: { language: "python" },
    models: { supported: ["openai", "deepseek", "ollama"] },
    interfaces: { cli: { command: "python app.py" } },
    ...overrides,
  } as Manifest;
}

describe("model resolution", () => {
  const dir = mkdtempSync(join(tmpdir(), "oah-mod-"));
  const vault = SecretsVault.open({ dir, passphrase: "p" });
  const key = "x/y@1.0.0";

  it("picks a provider with a stored key by default", () => {
    vault.set(key, { OPENAI_API_KEY: "sk-123" });
    const m = pickModel(manifest(), undefined, vault, key);
    assert.equal(m.provider, "openai");
    assert.equal(m.apiKey, "sk-123");
    vault.delete(key);
  });

  it("honors a requested provider", () => {
    vault.set(key, { DEEPSEEK_API_KEY: "ds-key" });
    const m = pickModel(manifest(), "deepseek", vault, key);
    assert.equal(m.provider, "deepseek");
    assert.equal(m.model, "deepseek-chat");
    vault.delete(key);
  });

  it("rejects a provider not in manifest.models.supported", () => {
    assert.throws(() => pickModel(manifest(), "anthropic", vault, key), ModelError);
  });

  it("fails when a key is missing for a cloud provider", () => {
    vault.delete(key);
    assert.throws(() => pickModel(manifest(), "openai", vault, key), ModelError);
  });

  it("allows keyless providers (ollama, local)", () => {
    const m = pickModel(manifest({ models: { supported: ["ollama"] } }), "ollama", vault, key);
    assert.equal(m.provider, "ollama");
  });

  it("builds agent env with model config", () => {
    const env = buildAgentEnv({ provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", apiKey: "k" }, "x/y", "1.0.0");
    assert.equal(env.AGENT_MODEL_PROVIDER, "deepseek");
    assert.equal(env.AGENT_MODEL_NAME, "deepseek-chat");
    assert.equal(env.AGENT_API_KEY, "k");
  });
});
