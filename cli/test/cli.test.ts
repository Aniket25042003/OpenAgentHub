import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "bin", "run.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { env?: Record<string, string>; cwd?: string } = {}, stdin?: string): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
      input: stdin,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

let home: string;
let proj: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "oah-cli-home-"));
  proj = mkdtempSync(join(tmpdir(), "oah-cli-proj-"));
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
});

const env = () => ({ AGENT_HOME: home });

describe("agent CLI", () => {
  it("init scaffolds a valid project", () => {
    const r = runCli(["init", "demo/hello", "--dir", proj], { env: env() });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(proj, "agent.yaml")));
    const manifest = readFileSync(join(proj, "agent.yaml"), "utf8");
    assert.match(manifest, /name: demo\/hello/);
  });

  it("validate accepts the manifest", () => {
    const r = runCli(["validate", proj], { env: env() });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /manifest valid: demo\/hello/);
  });

  it("validate rejects an invalid manifest", () => {
    const bad = mkdtempSync(join(tmpdir(), "oah-bad-"));
    writeFileSync(join(bad, "agent.yaml"), "name: bad\nversion: nope\n");
    const r = runCli(["validate", bad], { env: env() });
    assert.equal(r.code, 1);
    assert.match(r.stderr + r.stdout, /invalid|manifest/);
    rmSync(bad, { recursive: true, force: true });
  });

  it("publish --public-only packages and signs", () => {
    const r = runCli(["publish", proj, "--public-only"], { env: env(), cwd: proj });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /signature by key/);
    assert.ok(existsSync(join(proj, "demo_hello-0.1.0.ahb")));
    assert.ok(existsSync(join(proj, "demo_hello-0.1.0.ahb.sig.json")));
  });

  it("install from signed archive, verify, and run", () => {
    const archive = join(proj, "demo_hello-0.1.0.ahb");
    const r = runCli(["install", "demo/hello", "--file", archive, "--yes"], { env: env() });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /installed/);

    const v = runCli(["verify", "demo/hello"], { env: env() });
    assert.equal(v.code, 0, v.stderr);
    assert.match(v.stdout, /signature valid/);

    const run = runCli(["run", "demo/hello", "--model", "local", "--input", '{"name":"agent"}'], { env: env() });
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /"hello": "agent"/);
  });

  it("run rejects shell metacharacters safely", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-evil-"));
    writeFileSync(
      join(dir, "agent.yaml"),
      [
        "manifestVersion: 1",
        "name: demo/evil",
        "version: 1.0.0",
        "author: x",
        "description: evil",
        "license: MIT",
        "runtime: { language: python }",
        "models: { supported: [local] }",
        'interfaces: { cli: { command: "python app.py && echo pwned" } }',
      ].join("\n") + "\n",
    );
    writeFileSync(join(dir, "app.py"), "print('hi')\n");
    const r = runCli(["install", "demo/evil", "--dir", dir, "--yes"], { env: env() });
    assert.equal(r.code, 0, r.stderr);
    const run = runCli(["run", "demo/evil", "--model", "local"], { env: env() });
    assert.notEqual(run.code, 0);
    assert.match(run.stderr + run.stdout, /shell metacharacters/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("secrets are stored encrypted and never listed in plaintext", () => {
    const s = runCli(["env", "demo/hello", "OPENAI_API_KEY=sk-ultra-secret-value"], { env: env() });
    assert.equal(s.code, 0, s.stderr);
    const l = runCli(["env", "demo/hello"], { env: env() });
    assert.ok(l.stdout.includes("OPENAI_API_KEY"));
    assert.ok(!l.stdout.includes("sk-ultra-secret-value"));
    const revealed = runCli(["env", "demo/hello", "--reveal", "OPENAI_API_KEY"], { env: env() });
    assert.ok(revealed.stdout.includes("sk-ultra-secret-value"));
  });

  it("uninstall removes the agent", () => {
    const r = runCli(["uninstall", "demo/hello"], { env: env() });
    assert.equal(r.code, 0, r.stderr);
    const l = runCli(["list"], { env: env() });
    assert.ok(!l.stdout.includes("demo/hello"));
  });

  it("status --json emits a system snapshot", () => {
    const r = runCli(["status", "--json"], { env: env() });
    assert.equal(r.code, 0, r.stderr);
    const snap = JSON.parse(r.stdout);
    assert.ok(snap.host.hostname);
    assert.ok(Array.isArray(snap.agents));
    assert.ok(Array.isArray(snap.containers));
    assert.ok(Array.isArray(snap.openagenthub.installed));
  });

  it("ps --json lists containers or reports docker unavailable", () => {
    const r = runCli(["ps", "--json"], { env: env() });
    if (r.code === 0) {
      assert.ok(Array.isArray(JSON.parse(r.stdout)));
    } else {
      assert.match(r.stderr, /docker is not available/);
    }
  });

  it("forwards piped stdin to the agent when no --input is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-stdin-"));
    writeFileSync(
      join(dir, "agent.yaml"),
      [
        "manifestVersion: 1",
        "name: demo/stdin",
        "version: 1.0.0",
        "author: x",
        "description: reads stdin",
        "license: MIT",
        "runtime: { language: python }",
        "models: { supported: [local] }",
        "permissions: [none]",
        'interfaces: { cli: { command: "python app.py" } }',
      ].join("\n") + "\n",
    );
    writeFileSync(join(dir, "app.py"), "import sys, json\nprint(json.dumps({'got': json.load(sys.stdin)}))\n");
    const i = runCli(["install", "demo/stdin", "--dir", dir, "--yes"], { env: env() });
    assert.equal(i.code, 0, i.stderr);
    const run = runCli(["run", "demo/stdin", "--model", "local"], { env: env() }, '{"n": 42}');
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /"got": \{"n": 42\}/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("install --force guards against silent reinstalls", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-force-"));
    writeFileSync(
      join(dir, "agent.yaml"),
      [
        "manifestVersion: 1",
        "name: demo/force",
        "version: 1.0.0",
        "author: x",
        "description: force semantics",
        "license: MIT",
        "runtime: { language: python }",
        "models: { supported: [local] }",
        "permissions: [none]",
        'interfaces: { cli: { command: "python app.py" } }',
      ].join("\n") + "\n",
    );
    writeFileSync(join(dir, "app.py"), "print('hi')\n");
    const first = runCli(["install", "demo/force", "--dir", dir, "--yes"], { env: env() });
    assert.equal(first.code, 0, first.stderr);
    const second = runCli(["install", "demo/force", "--dir", dir, "--yes"], { env: env() });
    assert.equal(second.code, 1);
    assert.match(second.stdout + second.stderr, /already installed[\s\S]*--force/);
    const forced = runCli(["install", "demo/force", "--dir", dir, "--yes", "--force"], { env: env() });
    assert.equal(forced.code, 0, forced.stderr);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the highest installed version when no @version is given", () => {
    const mk = (version: string, out: string) => {
      const dir = mkdtempSync(join(tmpdir(), `oah-ver-${version}-`));
      writeFileSync(
        join(dir, "agent.yaml"),
        [
          "manifestVersion: 1",
          `name: demo/ver`,
          `version: ${version}`,
          "author: x",
          "description: versions",
          "license: MIT",
          "runtime: { language: python }",
          "models: { supported: [local] }",
          "permissions: [none]",
          'interfaces: { cli: { command: "python app.py" } }',
        ].join("\n") + "\n",
      );
      writeFileSync(join(dir, "app.py"), `print(${JSON.stringify({ v: out })})\n`);
      return dir;
    };
    const d1 = mk("1.0.0", "one");
    const d2 = mk("2.0.0", "two");
    assert.equal(runCli(["install", "demo/ver", "--dir", d1, "--yes"], { env: env() }).code, 0);
    assert.equal(runCli(["install", "demo/ver", "--dir", d2, "--yes"], { env: env() }).code, 0);

    const run = runCli(["run", "demo/ver", "--model", "local"], { env: env() });
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /note: multiple versions installed; running demo\/ver@2\.0\.0/);
    assert.match(run.stdout, /two/);

    const pinned = runCli(["run", "demo/ver@1.0.0", "--model", "local"], { env: env() });
    assert.equal(pinned.code, 0, pinned.stderr);
    assert.match(pinned.stdout, /one/);

    const ambiguous = runCli(["uninstall", "demo/ver"], { env: env() });
    assert.equal(ambiguous.code, 1);
    assert.match(ambiguous.stdout + ambiguous.stderr, /multiple versions/);

    const removed = runCli(["uninstall", "demo/ver@1.0.0"], { env: env() });
    assert.equal(removed.code, 0, removed.stderr);
    const last = runCli(["uninstall", "demo/ver"], { env: env() });
    assert.equal(last.code, 0, last.stderr);

    rmSync(d1, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  });

  it("refuses to treat a corrupt config.json as empty and shows recovery instructions", () => {
    const configPath = join(home, "config.json");
    const original = readFileSync(configPath, "utf8");
    writeFileSync(configPath, "{ this is not json ");
    const r = runCli(["list"], { env: env() });
    assert.equal(r.code, 1);
    assert.match(r.stdout + r.stderr, /not valid JSON/);
    assert.match(r.stdout + r.stderr, /recovery/);
    assert.equal(readFileSync(configPath, "utf8"), "{ this is not json ");
    writeFileSync(configPath, original);
  });
});
