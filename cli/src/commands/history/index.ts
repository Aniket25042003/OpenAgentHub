import { Command, Flags } from "@oclif/core";
import { listRuns, reconcileRuns } from "../../lib/supervisor.js";
import { printTable } from "../../lib/print.js";

export default class History extends Command {
  static description = "List run history with exit information (clean up with 'openagenthub history prune' or 'openagenthub remove')";

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(History);
    reconcileRuns();
    const runs = listRuns().reverse();
    if (flags.json) {
      this.logJson(runs);
      return;
    }
    if (runs.length === 0) {
      this.log("no runs recorded yet");
      return;
    }
    printTable(
      ["run", "agent", "iface", "sandbox", "state", "exit", "started"],
      runs.map((r) => [
        r.runId,
        r.agentKey,
        r.interfaceName,
        r.sandbox,
        r.state,
        r.exitCode !== undefined ? `${r.exitCode}${r.exitReason ? ` (${r.exitReason})` : ""}` : "-",
        r.startedAt,
      ]),
    );
  }
}
