import { Command } from "@oclif/core";
import { runDaemon } from "../lib/control-plane.js";
import { reconcileRuns } from "../lib/supervisor.js";

export default class Daemon extends Command {
  static hidden = true;
  static description = "Run the local control-plane daemon (dashboard + local API; started automatically)";

  async run(): Promise<void> {
    await runDaemon();
    const result = reconcileRuns();
    console.log(`supervisor reconciled: ${result.updated} run(s) updated, ${result.orphanedContainers.length} orphaned container(s)`);
  }
}
