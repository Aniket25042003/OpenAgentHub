import { Command, Flags } from "@oclif/core";
import { getUsageStats, openUsageStore, type UsageStats } from "@openagenthub/runtime";
import { printTable } from "../lib/print.js";

export default class Stats extends Command {
  static description = "Show local usage statistics (runs, tokens, cost, models, sandboxes)";

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
    from: Flags.string({ description: "include runs started at or after this date (YYYY-MM-DD)" }),
    to: Flags.string({ description: "include runs started at or before this date (YYYY-MM-DD)" }),
    noCache: Flags.boolean({ description: "bypass the aggregation cache" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Stats);
    const store = openUsageStore();
    try {
      const stats = getUsageStats(store, { from: flags.from, to: flags.to }, flags.noCache ? 0 : undefined);
      if (flags.json) {
        this.logJson(stats);
        return;
      }
      this.printHuman(stats);
    } finally {
      store.close();
    }
  }

  private printHuman(s: UsageStats): void {
    const range = s.range.from || s.range.to ? ` (${s.range.from ?? "beginning"} → ${s.range.to ?? "now"})` : "";
    this.log(`runs${range}:`);
    printTable(
      ["running", "healthy", "unhealthy", "stopped", "failed", "today", "all time"],
      [[s.runs.running, s.runs.healthy, s.runs.unhealthy, s.runs.stopped, s.runs.failed, s.runs.today, s.runs.allTime].map(String)],
    );
    this.log("");
    this.log("containers:");
    printTable(["current", "historical"], [[String(s.containers.current), String(s.containers.historical)]]);
    this.log("");
    if (s.tokens.available) {
      this.log("tokens:");
      printTable(
        ["input", "output", "reasoning", "cache"],
        [[s.tokens.input, s.tokens.output, s.tokens.reasoning, s.tokens.cache].map(String)],
      );
      this.log("");
      this.log("cost:");
      printTable(
        ["exact", "estimated"],
        [[s.cost.exactAvailable ? s.cost.exact.toFixed(6) : "n/a", s.cost.estimatedAvailable ? s.cost.estimated.toFixed(6) : "n/a"]],
      );
      this.log("");
    } else {
      this.log("no token usage recorded yet (unavailable, not zero)");
      this.log("");
    }
    if (s.models.length > 0) {
      this.log("models:");
      printTable(
        ["provider", "model", "runs", "tokens in", "tokens out"],
        s.models.map((m) => [m.provider, m.model, String(m.runs), String(m.tokensIn), String(m.tokensOut)]),
      );
      this.log("");
    }
    if (Object.keys(s.sandboxes).length > 0) {
      this.log("sandboxes:");
      printTable(
        ["mode", "runs"],
        Object.entries(s.sandboxes).map(([mode, count]) => [mode, String(count)]),
      );
      this.log("");
    }
    if (s.perAgent.length > 0) {
      this.log("per agent:");
      printTable(
        ["agent", "runs", "running", "last run"],
        s.perAgent.map((a) => [a.agentKey, String(a.runs), String(a.running), a.lastRunAt ?? "-"]),
      );
      this.log("");
    }
    this.log(
      `last event: ${s.lastEventAt ?? "none"} · aggregated: ${s.generatedAt}`,
    );
  }
}
