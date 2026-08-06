import { Command, Flags } from "@oclif/core";
import { listRuns, reconcileRuns, orphanContainers } from "../lib/supervisor.js";
import { printTable } from "../lib/print.js";

export default class Ps extends Command {
  static description = "List managed runs (--all for exited runs and orphaned containers)";

  static flags = {
    all: Flags.boolean({ char: "a", description: "list every run (active and ended) plus orphaned containers" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Ps);
    reconcileRuns();
    const runs = listRuns().reverse();
    const shown = flags.all ? runs : runs.filter((r) => ["starting", "running", "stopping"].includes(r.state));

    if (flags.json) {
      this.logJson({ runs: shown, orphanedContainers: flags.all ? orphanContainers() : [] });
      return;
    }

    if (shown.length === 0 && !flags.all) {
      this.log("no active runs (start one with: openagenthub run ns/name --detach)");
      return;
    }
    printTable(
      ["run", "agent", "iface", "sandbox", "state", "pid", "port"],
      shown.map((r) => [r.runId, r.agentKey, r.interfaceName, r.sandbox, r.state, r.pid ?? r.containerId?.slice(0, 12) ?? "-", r.port ?? "-"]),
    );

    if (flags.all) {
      const orphans = orphanContainers();
      if (orphans.length > 0) {
        this.log("");
        this.log(`orphaned containers (${orphans.length}):`);
        for (const o of orphans) this.log(`  ${o}`);
        this.log("remove with: docker rm -f <id>");
      }
    }
  }
}
