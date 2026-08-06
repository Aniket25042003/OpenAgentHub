import { detectRuntime, type Manifest, type Permission } from "@openagenthub/sdk";
import { buildAgentEnv, pickModel } from "./models.js";
import { effectivePermissions } from "./permissions.js";
import { SecretsVault } from "./secrets.js";
import { ContainerSandbox, dockerAvailable, dockerInstallHint } from "./sandbox/container.js";
import { ProcessSandbox } from "./sandbox/process.js";
import { effectiveSandbox, type SandboxOverride } from "./sandbox/policy.js";
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
  streamOutput?: boolean;
  reviewStatus?: string;
  statusFresh?: boolean;
  sandboxOverride?: SandboxOverride | null;
  archiveDigest?: string;
  runId?: string;
}

export interface RunAgentResult {
  result: RunResult;
  interfaceName: InterfaceName;
  sandbox: "container" | "process" | "none";
  model: { provider: string; model: string };
  sandboxReason?: string;
}

export class AgentRuntime {
  constructor(
    private readonly vault: SecretsVault,
    private readonly dockerCheck: () => boolean = dockerAvailable,
  ) {}

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

    const systemDeps = manifest.dependencies?.system;
    if (Array.isArray(systemDeps) && systemDeps.length > 0) {
      throw new Error("dependencies.system is not supported by OpenAgentHub yet");
    }

    const effective = effectivePermissions(manifest, Object.fromEntries(opts.granted.map((p) => [p, true])));
    if (effective.length !== opts.granted.length) {
      const dropped = opts.granted.filter((p) => !effective.includes(p)).join(", ");
      throw new Error(`refusing grants absent from the manifest: ${dropped}`);
    }

    const policy = effectiveSandbox({
      trust: opts.trustLevel,
      manifest,
      reviewStatus: opts.reviewStatus,
      statusFresh: opts.statusFresh,
      override: opts.sandboxOverride,
      archiveDigest: opts.archiveDigest,
    });
    if (policy.blocked) {
      throw new Error(policy.blocked);
    }

    if (policy.mode === "container" && !this.dockerCheck()) {
      throw new Error(dockerInstallHint());
    }

    const secrets = { ...this.vault.get(opts.agentKey), ...opts.extraSecrets };
    const model = pickModel(manifest, opts.model, this.vault, opts.agentKey);
    const env = buildAgentEnv(model, manifest.name, manifest.version);
    for (const [k, v] of Object.entries(secrets)) {
      env[k] = v;
    }
    env.AGENT_TRUST = opts.trustLevel;
    env.AGENT_HOME = opts.agentDir;
    env.AGENT_GRANTED_PERMISSIONS = effective.join(",");

    let sandbox: Sandbox;
    if (policy.mode === "container") {
      sandbox = new ContainerSandbox({
        agentDir: opts.agentDir,
        manifest,
        granted: effective,
        env,
        network: effective.includes("network"),
        user: process.env.USER ?? "user",
        host: process.env.HOSTNAME ?? "localhost",
        runId: opts.runId,
        interfaceName: iface,
        packageDigest: opts.archiveDigest,
      });
    } else {
      if (opts.trustLevel !== "trusted" && opts.trustLevel !== "local") {
        throw new Error("internal error: process sandbox chosen for non-trusted agent");
      }
      sandbox = new ProcessSandbox(
        {
          agentDir: opts.agentDir,
          manifest,
          granted: effective,
          env,
          network: effective.includes("network"),
          user: process.env.USER ?? "user",
          host: process.env.HOSTNAME ?? "localhost",
          runId: opts.runId,
          packageDigest: opts.archiveDigest,
        },
        opts.trustLevel,
      );
    }

    const command = this.commandFor(manifest, iface);
    const runOpts: RunOptions = { command, input: opts.input, timeoutMs: opts.timeoutMs, streamOutput: opts.streamOutput };

    let result: RunResult;
    if (opts.interactive) {
      const code = await sandbox.runInteractive(runOpts);
      result = { exitCode: code, stdout: "", stderr: "" };
    } else {
      result = await sandbox.run(runOpts);
    }

    return {
      result,
      interfaceName: iface,
      sandbox: sandbox.kind,
      model: { provider: model.provider, model: model.model },
      sandboxReason: policy.reason,
    };
  }
}
