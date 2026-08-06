import { Command, Flags, Args } from "@oclif/core";
import { confirmAll } from "../lib/prompt.js";
import { executeAgentRun, prepareRunContext } from "../lib/run-agent.js";
import {
  allocatePort,
  newRunId,
  readRun,
  waitForRunStart,
  writeRun,
  startManagedRun,
  type RunRecord,
} from "../lib/supervisor.js";

export default class Run extends Command {
  static description = "Run an installed agent (CLI, MCP, or HTTP interface)";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  static flags = {
    model: Flags.string({ description: "model provider, e.g. deepseek or openai:gpt-4o" }),
    interface: Flags.string({ options: ["cli", "mcp", "http"], default: "cli" }),
    input: Flags.string({ description: "JSON input passed to the agent on stdin" }),
    interactive: Flags.boolean({ description: "wire stdin/stdout to the terminal (MCP servers)" }),
    timeout: Flags.integer({ description: "timeout in ms (foreground default 120000; detached runs have no default timeout)" }),
    detach: Flags.boolean({ char: "d", description: "run in the background under the supervisor (managed run)" }),
    "agent-home": Flags.string({ description: "override agent home directory" }),
    "allow-secrets": Flags.boolean({ description: "grant all requested secrets without prompting" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Run);
    if (flags["agent-home"]) process.env.AGENT_HOME = flags["agent-home"];

    let input = flags.input;
    if (input === undefined && !process.stdin.isTTY && !flags.detach) {
      input = await new Promise<string>((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => (data += chunk));
        process.stdin.on("end", () => resolve(data));
      });
    }

    if (flags.detach && flags.interactive) {
      this.error("--detach cannot be combined with --interactive", { exit: 1 });
    }
    if (flags.detach && flags.interface === "cli" && flags.input === undefined && !process.stdin.isTTY) {
      this.warn("no --input given; the agent will read empty stdin");
    }

    let ctx;
    try {
      ctx = await prepareRunContext(args.spec, {
        allowSecrets: flags["allow-secrets"],
        confirmSecrets: process.stdin.isTTY ? (names) => confirmAll(names, false) : undefined,
        onNote: (msg) => this.log(msg),
      });
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }

    if (flags.detach) {
      const port = flags.interface === "http" ? await allocatePort() : undefined;
      const runId = newRunId();
      startManagedRun({
        runId,
        agentKey: ctx.agentKey,
        version: ctx.version,
        interfaceName: flags.interface as "cli" | "mcp" | "http",
        sandbox: ctx.installed.trust === "trusted" || ctx.installed.trust === "local" ? "process" : "container",
        port,
        timeoutMs: flags.timeout,
        input,
        digest: ctx.installed.archiveDigest,
      });
      const record = await waitForRunStart(runId);
      if (record.state === "failed") {
        this.error(`run ${runId} failed to start; see 'openagenthub logs ${runId}'`, { exit: 1 });
        return;
      }
      this.log(
        `run ${runId} (${ctx.manifest.name}@${ctx.version}, ${record.interfaceName}, ${record.sandbox}${record.port ? `, port ${record.port}` : ""})`,
      );
      this.log("manage with: openagenthub stop/restart/logs/inspect/ps/history");
      return;
    }

    const runId = newRunId();
    const history: RunRecord = {
      runId,
      agentKey: ctx.agentKey,
      version: ctx.version,
      interfaceName: flags.interface as "cli" | "mcp" | "http",
      sandbox: "none",
      managed: false,
      state: "starting",
      health: "unknown",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      restartPolicy: "none",
      digest: ctx.installed.archiveDigest,
    };
    writeRun(history);

    const result = await executeAgentRun(ctx, {
      interfaceName: flags.interface as "cli" | "mcp" | "http",
      input,
      timeoutMs: flags.timeout ?? 120_000,
      interactive: flags.interactive,
      model: flags.model,
      runId,
    });

    const final: RunRecord = {
      ...(readRun(runId) ?? history),
      sandbox: result.sandbox,
      state: result.result.exitCode === 0 ? "exited" : "failed",
      exitCode: result.result.exitCode,
      exitReason: result.result.timedOut ? "timeout" : result.sandbox === "container" && result.result.exitCode === 137 ? "oom" : "exit",
      endedAt: new Date().toISOString(),
      modelProvider: result.model.provider,
      modelName: result.model.model,
    };
    writeRun(final);

    if (result.sandboxReason) {
      this.log(`sandbox: ${result.sandbox} (${result.sandboxReason})`);
    }
    if (ctx.exposedSecrets.length > 0) {
      this.log(`exposed secrets: ${ctx.exposedSecrets.join(", ")}`);
    }

    if (flags.interactive) {
      this.exit(result.result.exitCode);
      return;
    }

    if (result.result.stdout) process.stdout.write(result.result.stdout);
    if (result.result.stderr) process.stderr.write(result.result.stderr);
    this.exit(result.result.exitCode);
  }
}
