import { Command, Args } from "@oclif/core";
import { executeAgentRun, prepareRunContext } from "../lib/run-agent.js";
import {
  allocatePort,
  dockerContainerByRunId,
  probeHttpHealth,
  readRun,
  writeRun,
  type RunRecord,
} from "../lib/supervisor.js";

export default class SupervisorRun extends Command {
  static description = "Internal supervisor worker for managed (detached) runs";

  static hidden = true;

  static args = { runId: Args.string({ required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(SupervisorRun);
    const initial = readRun(args.runId);
    if (!initial) {
      console.error(`run ${args.runId} not found`);
      process.exit(1);
    }
    let record: RunRecord = initial;

    const input = await new Promise<string>((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => (data += chunk));
      process.stdin.on("end", () => resolve(data));
    });

    record = { ...record, state: "running" };
    writeRun(record);

    const agentSpec = record.agentKey;
    const slash = agentSpec.lastIndexOf("/");
    const at = agentSpec.lastIndexOf("@");
    const namespace = agentSpec.slice(0, slash);
    const name = at > slash ? agentSpec.slice(slash + 1, at) : agentSpec.slice(slash + 1);
    const version = at > slash ? agentSpec.slice(at + 1) : undefined;

    const fail = (message: string): void => {
      const current = readRun(record.runId) ?? record;
      writeRun({
        ...current,
        state: "failed",
        exitReason: current.state === "stopping" ? "manual-stop" : "crashed",
        exitCode: 1,
        endedAt: new Date().toISOString(),
      });
      console.error(message);
      process.exit(1);
    };

    let ctx;
    try {
      ctx = await prepareRunContext({ namespace, name, version }, {});
    } catch (err) {
      fail(`failed to prepare run: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (record.interfaceName === "http" && record.port === undefined) {
      record = { ...(readRun(record.runId) ?? record), port: await allocatePort() };
      writeRun(record);
    }

    let finalizing = false;
    const finalize = (code: number, reason: "exit" | "timeout" | "oom" | "manual-stop" | "crashed"): void => {
      if (finalizing) return;
      finalizing = true;
      const current = readRun(record.runId) ?? record;
      writeRun({
        ...current,
        state: code === 0 ? "exited" : "failed",
        exitCode: code,
        exitReason: reason,
        endedAt: new Date().toISOString(),
      });
      process.exit(0);
    };

    if (record.sandbox !== "container") {
      process.on("SIGTERM", () => {
        finalize(0, "manual-stop");
      });
      process.on("SIGINT", () => {
        finalize(0, "manual-stop");
      });
    }

    let containerPoller: NodeJS.Timeout | undefined;
    if (record.sandbox === "container") {
      containerPoller = setInterval(() => {
        const container = dockerContainerByRunId(record.runId);
        const current = readRun(record.runId);
        if (container && current && current.containerId !== container.id) {
          writeRun({ ...current, containerId: container.id });
        }
      }, 1_000);
    }

    try {
      const result = await executeAgentRun(ctx, {
        interfaceName: record.interfaceName,
        input,
        timeoutMs: record.timeoutMs,
        runId: record.runId,
        streamOutput: true,
      });
      if (containerPoller) clearInterval(containerPoller);

      if (record.interfaceName === "http" && record.port) {
        const health = await probeHttpHealth(record.port);
        const current = readRun(record.runId) ?? record;
        writeRun({ ...current, health });
      }

      const current = readRun(record.runId) ?? record;
      const reason =
        current.state === "stopping" || current.exitReason === "manual-stop"
          ? "manual-stop"
          : result.result.timedOut
            ? "timeout"
            : result.result.exitCode === 137
              ? "oom"
              : "exit";
      finalize(result.result.exitCode, reason);
    } catch (err) {
      if (containerPoller) clearInterval(containerPoller);
      console.error(err instanceof Error ? err.message : String(err));
      finalize(1, "crashed");
    }
  }
}
