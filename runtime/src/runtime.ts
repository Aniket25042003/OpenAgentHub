import { decideSandbox, detectRuntime, type Manifest, type Permission } from "@openagenthub/sdk";
import { buildAgentEnv, pickModel } from "./models.js";
import { SecretsVault } from "./secrets.js";
import { ContainerSandbox } from "./sandbox/container.js";
import { ProcessSandbox } from "./sandbox/process.js";
import type { RunOptions, RunResult, Sandbox } from "./sandbox/types.js";

export type InterfaceName = "cli" | "mcp" | "http";

export interface RunAgentOptions {
  agentDir: string;
  manifest: Manifest;
  agentKey: string;
  interfaceName?: InterfaceName;
  input?: string;
  granted: Permission[];
  trustLevel: "trusted" | "untrusted" | "unknown" | "local";
  model?: string;
  extraSecrets?: Record<string, string>;
  timeoutMs?: number;
  interactive?: boolean;
}

export interface RunAgentResult {
  result: RunResult;
  interfaceName: InterfaceName;
  sandbox: "container" | "process" | "none";
  model: { provider: string; model: string };
}

export class AgentRuntime {
  constructor(private readonly vault: SecretsVault) {}

  private commandFor(manifest: Manifest, iface: InterfaceName): string {
    if (iface === "cli") {
      if (!manifest.interfaces.cli) throw new Error("manifest has no cli interface");
      return manifest.interfaces.cli.command;
    }
    if (iface === "mcp") {
      if (!manifest.interfaces.mcp) throw new Error("manifest has no mcp interface");
      return manifest.interfaces.mcp.entrypoint;
    }
    throw new Error("http interface is handled by the CLI, not the local runtime");
  }

  async runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
    const manifest = opts.manifest;
    const iface = opts.interfaceName ?? "cli";

    if (iface === "http") {
      const ep = manifest.interfaces.http?.endpoint;
      if (!ep) throw new Error("manifest has no http interface");
      return {
        interfaceName: "http",
        sandbox: "none",
        model: { provider: manifest.models.supported[0], model: "remote" },
        result: { exitCode: 0, stdout: `remote agent endpoint: ${ep}`, stderr: "" },
      };
    }

    const secrets = { ...this.vault.get(opts.agentKey), ...opts.extraSecrets };
    const model = pickModel(manifest, opts.model, this.vault, opts.agentKey);
    const env = buildAgentEnv(model, manifest.name, manifest.version);
    for (const [k, v] of Object.entries(secrets)) {
      env[k] = v;
    }
    env.AGENT_TRUST = opts.trustLevel;
    env.AGENT_HOME = opts.agentDir;
    env.AGENT_GRANTED_PERMISSIONS = opts.granted.join(",");

    const detected = detectRuntime();
    const strategy = decideSandbox(manifest, detected, opts.trustLevel);

    let sandbox: Sandbox;
    if (strategy.mode === "container") {
      sandbox = new ContainerSandbox({
        agentDir: opts.agentDir,
        manifest,
        granted: opts.granted,
        env,
        network: opts.granted.includes("network"),
        user: process.env.USER ?? "user",
        host: process.env.HOSTNAME ?? "localhost",
      });
    } else {
      if (opts.trustLevel !== "trusted" && opts.trustLevel !== "local") {
        throw new Error("internal error: process sandbox chosen for non-trusted agent");
      }
      sandbox = new ProcessSandbox(
        {
          agentDir: opts.agentDir,
          manifest,
          granted: opts.granted,
          env,
          network: opts.granted.includes("network"),
          user: process.env.USER ?? "user",
          host: process.env.HOSTNAME ?? "localhost",
        },
        opts.trustLevel,
      );
    }

    const command = this.commandFor(manifest, iface);
    const runOpts: RunOptions = { command, input: opts.input, timeoutMs: opts.timeoutMs };

    let result: RunResult;
    if (opts.interactive) {
      const code = await sandbox.runInteractive(runOpts);
      result = { exitCode: code, stdout: "", stderr: "" };
    } else {
      result = await sandbox.run(runOpts);
    }

    return { result, interfaceName: iface, sandbox: sandbox.kind, model: { provider: model.provider, model: model.model } };
  }
}
