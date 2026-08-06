import { Command, Args } from "@oclif/core";
import { readFileSync, rmSync } from "node:fs";
import { openUsageStore, type UsageSample } from "@openagenthub/runtime";
import { executeAgentRun, prepareRunContext } from "../lib/run-agent.js";
import {
  allocatePort,
  containerStats,
  dockerContainerByRunId,
  probeHttpHealth,
  readRun,
  runLogPath,
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

    const usageFilePath = `${runLogPath(record.runId)}.usage.jsonl`;

    const recordUsage = (): void => {
      let raw: string;
      try {
        raw = readFileSync(usageFilePath, "utf8");
      } catch {
        return;
      }
      const samples: UsageSample[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          samples.push(JSON.parse(line) as UsageSample);
        } catch {
          /* skip malformed usage lines */
        }
      }
      if (samples.length === 0) return;
      const store = openUsageStore();
      for (const s of samples) {
        store.recordUsage({ ...s, runId: record.runId });
      }
      store.close();
    };

    const recordResourceSample = (): void => {
      const containerId = (readRun(record.runId) ?? record).containerId;
      if (!containerId) return;
      const stats = containerStats(containerId);
      if (!stats) return;
      const store = openUsageStore();
      store.recordResourceSample({
        runId: record.runId,
        containerId,
        memBytes: Number(stats.memUsage?.split("/")[0]?.trim().replace(/[^\d.]/g, "")) || undefined,
        cpuPercent: Number(stats.cpuPerc?.replace("%", "")) || undefined,
      });
      store.close();
    };

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
        state: reason === "manual-stop" ? "exited" : code === 0 ? "exited" : "failed",
        exitCode: reason === "manual-stop" ? 0 : code,
        exitReason: reason,
        endedAt: new Date().toISOString(),
      });
      recordUsage();
      recordResourceSample();
      rmSync(usageFilePath, { force: true });
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
        usageFilePath,
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
            : result.sandbox === "container" && result.result.exitCode === 137
              ? "oom"
              : "exit";
      writeRun({
        ...current,
        modelProvider: result.model.provider,
        modelName: result.model.model,
      });
      finalize(result.result.exitCode, reason);
    } catch (err) {
      if (containerPoller) clearInterval(containerPoller);
      console.error(err instanceof Error ? err.message : String(err));
      finalize(1, "crashed");
    }
  }
}
