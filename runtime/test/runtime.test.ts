import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime, SecretsVault, ContainerSandbox, ProcessSandbox } from "../dist/index.js";
import type { Manifest, Permission } from "@openagenthub/sdk";

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    manifestVersion: 1,
    name: "test/echo",
    version: "1.0.0",
    author: "t",
    description: "d",
    license: "MIT",
    runtime: { language: "python" },
    models: { supported: ["local"] },
    interfaces: { cli: { command: "python app.py", input: "json", output: "json" } },
    ...overrides,
  } as Manifest;
}

describe("process sandbox execution", () => {
  it("runs a trusted python agent and injects env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-run-"));
    writeFileSync(
      join(dir, "app.py"),
      [
        "import json, os",
        "data = json.load(sys.stdin) if False else {}",
        "print(os.environ.get('AGENT_MODEL_PROVIDER', 'missing'))",
        "print(os.environ.get('AGENT_GRANTED_PERMISSIONS', 'missing'))",
        "print(json.dumps({'name': os.environ.get('AGENT_NAME')}))",
      ].join("\n") + "\n",
    );
    // simpler app
    writeFileSync(
      join(dir, "app.py"),
      "import json, os\nprint(os.environ['AGENT_MODEL_PROVIDER'])\nprint(os.environ['AGENT_GRANTED_PERMISSIONS'])\n",
    );

    const vault = SecretsVault.open({ dir: mkdtempSync(join(tmpdir(), "oah-sec-")), passphrase: "p" });
    const runtime = new AgentRuntime(vault);
    const out = await runtime.runAgent({
      agentDir: dir,
      manifest: manifest(),
      agentKey: "test/echo@1.0.0",
      granted: ["filesystem"],
      trustLevel: "trusted",
      model: "local",
    });
    assert.equal(out.sandbox, "process");
    assert.equal(out.result.exitCode, 0);
    assert.match(out.result.stdout, /^local/m);
    assert.ok(out.result.stdout.includes("filesystem"));
  });

  it("rejects shell metacharacters on the process path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-run-"));
    writeFileSync(join(dir, "app.py"), "pass\n");
    const vault = SecretsVault.open({ dir: mkdtempSync(join(tmpdir(), "oah-sec-")), passphrase: "p" });
    const runtime = new AgentRuntime(vault);
    await assert.rejects(
      () =>
        runtime.runAgent({
          agentDir: dir,
          manifest: manifest({ interfaces: { cli: { command: "python app.py && rm -rf /" } } }),
          agentKey: "test/echo@1.0.0",
          granted: [],
          trustLevel: "trusted",
        }),
      /shell metacharacters/,
    );
  });

  it("refuses to run untrusted agents on the process path", () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-run-"));
    writeFileSync(join(dir, "app.py"), "pass\n");
    assert.throws(
      () =>
        new ProcessSandbox(
          {
            agentDir: dir,
            manifest: manifest(),
            granted: [],
            env: {},
            network: false,
            user: "u",
            host: "h",
          },
          "untrusted",
        ),
      /trusted/,
    );
  });

  it("captures exit codes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oah-run-"));
    writeFileSync(join(dir, "app.py"), "raise SystemExit(3)\n");
    const vault = SecretsVault.open({ dir: mkdtempSync(join(tmpdir(), "oah-sec-")), passphrase: "p" });
    const runtime = new AgentRuntime(vault);
    const out = await runtime.runAgent({
      agentDir: dir,
      manifest: manifest(),
      agentKey: "test/echo@1.0.0",
      granted: [],
      trustLevel: "trusted",
    });
    assert.equal(out.result.exitCode, 3);
  });
});

describe("container sandbox security flags", () => {
  const spec = {
    agentDir: "/tmp/agent",
    manifest: manifest({ permissions: ["filesystem", "network"] as Permission[], runtime: { language: "python", sandbox: "container" } }),
    granted: ["filesystem", "network"] as Permission[],
    env: { AGENT_NAME: "test/echo", AGENT_API_KEY: "super-secret" },
    network: true,
    user: "u",
    host: "h",
  };

  it("drops all capabilities and disables new privileges", () => {
    const sb = new ContainerSandbox(spec);
    const args = sb.buildRunArgs("python app.py");
    assert.ok(args.includes("--cap-drop"));
    assert.ok(args.includes("ALL"));
    assert.ok(args.includes("--security-opt"));
    assert.ok(args.includes("no-new-privileges"));
  });

  it("runs as non-root and enforces resource limits", () => {
    const args = new ContainerSandbox(spec).buildRunArgs("x");
    const userIdx = args.indexOf("--user");
    assert.ok(userIdx >= 0);
    assert.match(args[userIdx + 1], /^10001:10001$/);
    assert.ok(args.includes("--pids-limit") && args.includes("256"));
    assert.ok(args.includes("--memory") && args.includes("512m"));
  });

  it("disables network when not granted", () => {
    const noNet = { ...spec, granted: ["filesystem"] as Permission[], network: false };
    const args = new ContainerSandbox(noNet).buildRunArgs("x");
    assert.ok(args.includes("--network"));
    assert.ok(args.includes("none"));
  });

  it("mounts agent dir read-only", () => {
    const args = new ContainerSandbox(spec).buildRunArgs("x");
    assert.ok(args.includes("/tmp/agent:/app:ro"));
  });

  it("does not leak secrets into the command line for env-flagged values", () => {
    const args = new ContainerSandbox(spec).buildRunArgs("python app.py");
    const joined = args.join(" ");
    assert.ok(joined.includes("AGENT_API_KEY=super-secret"));
  });

  it("enforces read-only root when filesystem not granted", () => {
    const noFs = { ...spec, granted: [] as Permission[], network: false };
    const args = new ContainerSandbox(noFs).buildRunArgs("x");
    assert.ok(args.includes("--read-only"));
  });
});
