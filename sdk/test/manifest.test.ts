import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseManifest, validateManifest, assertValidManifest, ManifestValidationError } from "../dist/index.js";

const VALID_MANIFEST = `
manifestVersion: 1
name: github/pr-reviewer
version: 1.0.3
author: aniket
description: Reviews GitHub pull requests
license: MIT
runtime:
  language: python
  python: ">=3.11"
framework:
  name: LangGraph
models:
  supported: [openai, anthropic, ollama, deepseek, google]
interfaces:
  cli:
    command: python -m pr_reviewer
    input: json
    output: json
permissions: [filesystem, github, network]
dependencies:
  pip: [langgraph>=0.2, httpx]
secrets: [GITHUB_TOKEN, OPENAI_API_KEY]
tags: [coding, github]
`;

describe("manifest validation", () => {
  it("accepts a valid manifest", () => {
    const obj = parseManifest(VALID_MANIFEST);
    const res = validateManifest(obj);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    const m = assertValidManifest(obj);
    assert.equal(m.name, "github/pr-reviewer");
  });

  it("rejects an unknown top-level key (strict schema)", () => {
    const obj = parseManifest(VALID_MANIFEST);
    (obj as Record<string, unknown>).evilInjected = "pwn";
    const res = validateManifest(obj);
    assert.equal(res.valid, false);
  });

  it("rejects an unknown permission", () => {
    const obj = parseManifest(VALID_MANIFEST);
    (obj as Record<string, unknown>).permissions = ["sudo"];
    assert.equal(validateManifest(obj).valid, false);
  });

  it("rejects a bad version", () => {
    const obj = parseManifest(VALID_MANIFEST);
    (obj as Record<string, unknown>).version = "1.0";
    assert.equal(validateManifest(obj).valid, false);
  });

  it("rejects a name with uppercase / unsafe characters", () => {
    const obj = parseManifest(VALID_MANIFEST);
    (obj as Record<string, unknown>).name = "../../../etc/passwd";
    assert.equal(validateManifest(obj).valid, false);
    (obj as Record<string, unknown>).name = "UPPER/name";
    assert.equal(validateManifest(obj).valid, false);
  });

  it("requires at least one interface", () => {
    const obj = parseManifest(VALID_MANIFEST);
    (obj as Record<string, unknown>).interfaces = {};
    assert.equal(validateManifest(obj).valid, false);
  });

  it("rejects a missing models.supported", () => {
    const obj = parseManifest(VALID_MANIFEST);
    (obj as Record<string, unknown>).models = { supported: [] };
    assert.equal(validateManifest(obj).valid, false);
  });

  it("rejects bad secret names", () => {
    const obj = parseManifest(VALID_MANIFEST);
    (obj as Record<string, unknown>).secrets = ["GITHUB TOKEN", "lowercase", "1DIGIT"];
    assert.equal(validateManifest(obj).valid, false);
  });

  it("throws ManifestValidationError for invalid input", () => {
    assert.throws(() => assertValidManifest(parseManifest("name: nope\n")), ManifestValidationError);
  });
});
