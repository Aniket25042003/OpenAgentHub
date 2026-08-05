import { Command, Args, Flags } from "@oclif/core";
import { containerStats, readRun, readRunLogTail, reconcileRun } from "../lib/supervisor.js";
import { writeRun } from "../lib/supervisor.js";

export default class Inspect extends Command {
  static description = "Inspect a run: state, identity, limits, resource use, recent output";

  static args = { runId: Args.string({ required: true, description: "run id (see 'openagenthub ps')" }) };

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Inspect);
    let record = readRun(args.runId);
    if (!record) {
      this.error(`run ${args.runId} not found (see 'openagenthub history')`, { exit: 1 });
      return;
    }
    record = reconcileRun(record);
    if (record.state !== readRun(args.runId)?.state) writeRun(record);

    if (flags.json) {
      this.logJson(record);
      return;
    }

    this.log(`run:           ${record.runId}`);
    this.log(`agent:         ${record.agentKey}`);
    this.log(`interface:     ${record.interfaceName}  sandbox: ${record.sandbox}${record.managed ? "  (managed)" : ""}`);
    this.log(`state:         ${record.state}${record.health !== "unknown" ? `  health: ${record.health}` : ""}`);
    this.log(`started:       ${record.startedAt}`);
    if (record.endedAt) this.log(`ended:         ${record.endedAt}`);
    if (record.exitCode !== undefined) this.log(`exit:          code ${record.exitCode} (${record.exitReason ?? "unknown"})`);
    if (record.pid) this.log(`worker pid:    ${record.pid}`);
    if (record.containerId) this.log(`container:     ${record.containerId.slice(0, 12)}`);
    if (record.port) this.log(`port:          ${record.port}`);
    this.log(`restart:       policy ${record.restartPolicy}`);
    if (record.digest) this.log(`digest:        ${record.digest}`);

    if (record.containerId) {
      const stats = containerStats(record.containerId);
      if (stats) this.log(`resources:     mem ${stats.memUsage} (${stats.memPerc})  cpu ${stats.cpuPerc}`);
    }

    const tail = readRunLogTail(args.runId, 15);
    if (tail) {
      this.log("recent output:");
      for (const line of tail.split("\n").slice(0, 15)) this.log(`  ${line}`);
    }
  }
}
