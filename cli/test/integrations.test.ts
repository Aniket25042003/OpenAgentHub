import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "bin", "run.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { env?: Record<string, string> } = {}, stdin?: string): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...opts.env },
      input: stdin,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function claudeEvent(uuid = "evt-1"): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00.000Z",
    message: { uuid, model: "claude-sonnet-4-20250514", session_id: "s1", usage: { input_tokens: 100, output_tokens: 50 } },
  });
}

let home: string;
let claudeDir: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "oah-int-home-"));
  claudeDir = mkdtempSync(join(tmpdir(), "oah-int-claude-"));
  mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
  writeFileSync(join(claudeDir, "projects", "p1", "s.jsonl"), claudeEvent() + "\n" + claudeEvent("evt-2") + "\n");
});

beforeEach(() => {
  rmSync(join(claudeDir, "projects"), { recursive: true, force: true });
  mkdirSync(join(claudeDir, "projects", "p1"), { recursive: true });
  writeFileSync(join(claudeDir, "projects", "p1", "s.jsonl"), claudeEvent() + "\n");
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(claudeDir, { recursive: true, force: true });
});

const env = () => ({
  AGENT_HOME: home,
  OPENAGENTHUB_CLAUDE_DIR: claudeDir,
  OPENAGENTHUB_CODEX_DIR: join(claudeDir, "..", "codex"),
  OPENAGENTHUB_OPENCODE_DIR: join(claudeDir, "..", "opencode"),
});

const clean = (s: string) => s.trim();

describe("third-party usage and limits (M-5)", () => {
  it("does not read local provider data without credentials consent", () => {
    const r = runCli(["limits", "--json"], { env: env() });
    assert.equal(r.code, 0);
    const body = JSON.parse(r.stdout);
    assert.ok(body.collection.every((p: { provider?: string; status: string }) => p.status === "disabled" || p.status === "missing"));
    assert.equal(body.usage.length, 0);
    assert.equal(body.limits.length, 0);
  });

  it("integrations status reflects consents and sources", () => {
    const r = runCli(["integrations"], { env: env() });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^provider\s+enabled\s+detected\s+credentials\s+live\s+data source/m);
    assert.match(r.stdout, /claude\s+yes\s+yes\s+-\s+-/);
    assert.match(r.stdout, /grant access with: openagenthub integrations enable <provider>/);
  });

  it("granting consent enables collection of local usage", () => {
    const grant = runCli(["integrations", "enable", "claude", "--credentials"], { env: env() });
    assert.equal(grant.code, 0);

    const status = runCli(["integrations", "--json"], { env: env() });
    const statuses = JSON.parse(status.stdout);
    const claude = statuses.find((s: { provider: string }) => s.provider === "claude");
    assert.equal(claude.enabled, true);
    assert.equal(claude.consent.credentials, true);

    const r = runCli(["limits", "--json"], { env: env() });
    const body = JSON.parse(r.stdout);
    const collected = body.collection.find((p: { provider: string }) => p.provider === "claude");
    assert.equal(collected.status, "ok");
    assert.equal(collected.eventsIngested, 1);
    assert.equal(body.usage.length, 1);
    assert.equal(body.usage[0].provider, "claude");
    assert.equal(body.usage[0].tokensIn, 100);
  });

  it("limits set stores a manual limit shown by limits", () => {
    const set = runCli(["limits", "set", "claude", "--window", "weekly", "--plan", "max", "--used-percent", "40", "--credits-total", "1000000"], { env: env() });
    assert.equal(set.code, 0);
    const r = runCli(["limits", "--json"], { env: env() });
    const body = JSON.parse(r.stdout);
    assert.ok(body.limits.some((l: { provider: string; window: string; plan: string; usedPercent: number }) => l.provider === "claude" && l.window === "weekly" && l.plan === "max" && l.usedPercent === 40));
  });

  it("disabling revokes consent and clears cached usage and limits", () => {
    runCli(["integrations", "enable", "claude", "--credentials"], { env: env() });
    const after = runCli(["limits", "--json"], { env: env() });
    assert.equal(JSON.parse(after.stdout).usage.length, 1);

    const off = runCli(["integrations", "disable", "claude"], { env: env() });
    assert.equal(off.code, 0);
    assert.match(off.stdout, /removed 1 cached usage event/);

    const status = runCli(["integrations", "--json"], { env: env() });
    const claude = JSON.parse(status.stdout).find((s: { provider: string }) => s.provider === "claude");
    assert.equal(claude?.enabled, false);
    assert.equal(claude?.consent.credentials, false);
  });

  it("set-key stores a key without echoing it and --unset removes it", () => {
    const stdin = "sk-test-1234567890";
    const r = runCli(["integrations", "set-key", "claude"], { env: env() }, stdin);
    assert.equal(r.code, 0);
    assert.ok(!r.stdout.includes(stdin), "the key must never be logged");
    assert.match(r.stdout, /ANTHROPIC_API_KEY/);

    const unset = runCli(["integrations", "set-key", "claude", "--unset"], { env: env() });
    assert.equal(unset.code, 0);
  });
});