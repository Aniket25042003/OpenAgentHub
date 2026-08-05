import { Command, Flags } from "@oclif/core";
import type { UsageProvider } from "@openagenthub/runtime";
import { printTable } from "../../lib/print.js";
import { collectProviderData, isProvider, PROVIDER_NAMES } from "../../lib/integrations.js";

export default class Limits extends Command {
  static description = "Show third-party token usage and subscription limits (Claude Code, Codex, OpenCode)";

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
    provider: Flags.string({ description: `filter to one provider (${PROVIDER_NAMES.join(", ")})` }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Limits);
    if (flags.provider !== undefined && !isProvider(flags.provider)) {
      this.error(`unknown provider '${flags.provider}' (expected one of: ${PROVIDER_NAMES.join(", ")})`, { exit: 1 });
    }
    const data = collectProviderData(flags.provider as UsageProvider | undefined);
    if (flags.json) {
      this.logJson(data);
      return;
    }
    this.printHuman(data);
  }

private printHuman(data: ReturnType<typeof collectProviderData>): void {
    for (const p of data.collection) {
      if (p.status !== "ok") this.log(`${p.provider}: ${p.status} — ${p.message ?? (p.detected ? "data sources present" : "no data sources found")}`);
    }
    if (data.usage.length === 0 && data.limits.length === 0) {
      this.log("no provider usage data available yet (unavailable, not zero)");
      this.log("");
      return;
    }
if (data.usage.length > 0) {
      this.log("provider usage:");
      printTable(
        ["provider", "tokens in", "tokens out", "events", "last observed"],
        data.usage.map((u) => [u.provider, String(u.tokensIn), String(u.tokensOut), String(u.events), u.lastObservedAt ?? "never"]),
      );
      this.log("");
    }
    if (data.limits.length > 0) {
      this.log("limits:");
      printTable(
        ["provider", "window", "plan", "used %", "units", "used", "total", "resets", "source"],
        (data.limits as Array<{ provider: string; window: string; plan?: string; usedPercent?: number; units?: string; creditsUsed?: number; creditsTotal?: number; resetAt?: string; source: string }>).map(
          (l) => [
            l.provider,
            l.window,
            l.plan ?? "n/a",
            l.usedPercent !== undefined ? `${l.usedPercent}%` : "n/a",
            l.units ?? "n/a",
            l.creditsUsed !== undefined ? String(l.creditsUsed) : "n/a",
            l.creditsTotal !== undefined ? String(l.creditsTotal) : "n/a",
            l.resetAt ?? "n/a",
            l.source,
          ],
        ),
      );
      this.log("");
    }
  }
}