import { Command, Flags } from "@oclif/core";
import { openUsageStore, type PruneOptions } from "@openagenthub/runtime";
import { removeRun } from "../../lib/supervisor.js";

export default class HistoryPrune extends Command {
  static description = "Delete run history, usage rows, and logs. With no flags, honors dashboard retention settings.";

  static flags = {
    "older-than": Flags.integer({ description: "delete runs older than N days" }),
    keep: Flags.integer({ description: "keep only the newest N runs" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(HistoryPrune);
    const store = openUsageStore();
    try {
      const opts: PruneOptions = {};
      if (flags["older-than"] !== undefined) opts.olderThanDays = flags["older-than"];
      if (flags.keep !== undefined) opts.keep = flags.keep;
      let candidates: string[];
      if (Object.keys(opts).length === 0) {
        const days = Number(store.getSetting("retention.days") ?? 0);
        const keep = Number(store.getSetting("retention.max_runs") ?? 0);
        if (!(days > 0) && !(keep > 0)) {
          this.log("no retention settings configured and no flags given; nothing to prune");
          this.log('set retention on the dashboard, or pass --older-than <days> / --keep <n>');
          return;
        }
        candidates = store.pruneCandidates({ olderThanDays: days > 0 ? days : undefined, keep: keep > 0 ? keep : undefined });
      } else {
        candidates = store.pruneCandidates(opts);
      }
      for (const id of candidates) removeRun(id);
      if (flags.json) {
        this.logJson({ runsRemoved: candidates.length });
        return;
      }
      this.log(`pruned ${candidates.length} run(s)`);
    } finally {
      store.close();
    }
  }
}
