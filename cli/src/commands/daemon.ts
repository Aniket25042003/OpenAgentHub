import { Command } from "@oclif/core";
import { openUsageStore } from "@openagenthub/runtime";
import { runDaemon } from "../lib/control-plane.js";
import { reconcileRuns, removeRun } from "../lib/supervisor.js";

export default class Daemon extends Command {
  static hidden = true;
  static description = "Run the local control-plane daemon (dashboard + local API; started automatically)";

  async run(): Promise<void> {
    await runDaemon();
    const result = reconcileRuns();
    console.log(`supervisor reconciled: ${result.updated} run(s) updated, ${result.orphanedContainers.length} orphaned container(s)`);
    const store = openUsageStore();
    try {
      const days = Number(store.getSetting("retention.days") ?? 0);
      const keep = Number(store.getSetting("retention.max_runs") ?? 0);
      if (days > 0 || keep > 0) {
        const candidates = store.pruneCandidates({ olderThanDays: days > 0 ? days : undefined, keep: keep > 0 ? keep : undefined });
        for (const id of candidates) removeRun(id);
        if (candidates.length > 0) console.log(`retention cleanup: pruned ${candidates.length} run(s)`);
      }
    } finally {
      store.close();
    }
  }
}
