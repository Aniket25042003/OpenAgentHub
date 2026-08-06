import { Command, Flags } from "@oclif/core";
import { openUsageStore } from "@openagenthub/runtime";

export default class HistoryExport extends Command {
  static description = "Export local usage data (run metadata, token counts, cost, resource samples) as JSON. Logs and prompts are never included.";

  static flags = {
    from: Flags.string({ description: "only runs started at or after this date (YYYY-MM-DD)" }),
    to: Flags.string({ description: "only runs started at or before this date (YYYY-MM-DD)" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(HistoryExport);
    const store = openUsageStore();
    try {
      const data = store.exportData();
      if (flags.from || flags.to) {
        const from = flags.from ? new Date(flags.from).toISOString() : null;
        const to = flags.to ? new Date(flags.to).toISOString() : null;
        data.runs = data.runs.filter((r) => {
          const started = String((r as { started_at: string }).started_at);
          if (from && started < from) return false;
          if (to && started > to) return false;
          return true;
        });
        const kept = new Set(data.runs.map((r) => (r as { run_id: string }).run_id));
        data.usage = data.usage.filter((u) => kept.has(String((u as { run_id: string }).run_id)));
        data.resources = data.resources.filter((r) => kept.has(String((r as { run_id: string }).run_id)));
      }
      this.logJson({ exportedAt: new Date().toISOString(), schemaVersion: 1, ...data });
    } finally {
      store.close();
    }
  }
}
