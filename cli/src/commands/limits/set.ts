import { Command, Flags, Args } from "@oclif/core";
import { openUsageStore, setManualLimit } from "@openagenthub/runtime";
import type { LimitRow, UsageProvider } from "@openagenthub/runtime";
import { isProvider, PROVIDER_NAMES } from "../../lib/integrations.js";

export default class LimitsSet extends Command {
  static description = "Set a manual subscription-limit value for a provider window";

  static args = {
    provider: Args.string({ required: true, description: `provider (${PROVIDER_NAMES.join(", ")})` }),
  };

  static flags = {
    window: Flags.string({ description: "window label, e.g. weekly, monthly, 5m (default: manual)" }),
    plan: Flags.string({ description: "plan name, e.g. pro, max, free" }),
    "used-percent": Flags.string({ description: "percentage of the limit used (0-100)" }),
    units: Flags.string({ description: "limit units, e.g. input_tokens, requests" }),
    "credits-used": Flags.string({ description: "credits/tokens used" }),
    "credits-total": Flags.string({ description: "credits/tokens allowed in the window" }),
    reset: Flags.string({ description: "ISO reset time (when the window resets)" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LimitsSet);
    const provider = args.provider as string;
    if (!isProvider(provider)) {
      this.error(`unknown provider '${provider}' (expected one of: ${PROVIDER_NAMES.join(", ")})`, { exit: 1 });
    }
    if (!flags.window && !flags.plan && flags["used-percent"] === undefined && !flags.units && flags["credits-used"] === undefined && flags["credits-total"] === undefined && !flags.reset) {
      this.error("provide at least one value (--window, --plan, --used-percent, --units, --credits-used, --credits-total, --reset)", { exit: 1 });
    }
    const limit: Omit<LimitRow, "observedAt" | "source"> & { source?: LimitRow["source"] } = {
      provider: provider as UsageProvider,
      window: flags.window ?? "manual",
    };
    if (flags.plan) limit.plan = flags.plan;
    if (flags.units) limit.units = flags.units;
    if (flags.reset) {
      if (Number.isNaN(Date.parse(flags.reset))) this.error(`invalid --reset time '${flags.reset}' (expected ISO 8601)`, { exit: 1 });
      limit.resetAt = new Date(flags.reset).toISOString();
    }
    const percent = flags["used-percent"] !== undefined ? Number(flags["used-percent"]) : undefined;
    if (flags["used-percent"] !== undefined) {
      if (!Number.isFinite(percent!) || percent! < 0 || percent! > 100) this.error("--used-percent must be a number between 0 and 100", { exit: 1 });
      limit.usedPercent = percent;
    }
    const used = flags["credits-used"] !== undefined ? Number(flags["credits-used"]) : undefined;
    if (flags["credits-used"] !== undefined) {
      if (!Number.isFinite(used!) || used! < 0) this.error("--credits-used must be a non-negative number", { exit: 1 });
      limit.creditsUsed = used;
    }
    const total = flags["credits-total"] !== undefined ? Number(flags["credits-total"]) : undefined;
    if (flags["credits-total"] !== undefined) {
      if (!Number.isFinite(total!) || total! < 0) this.error("--credits-total must be a non-negative number", { exit: 1 });
      limit.creditsTotal = total;
    }

    const store = openUsageStore();
    try {
      setManualLimit(store, limit);
      if (flags.json) {
        this.logJson({ provider, window: limit.window, stored: true });
        return;
      }
      this.log(`stored manual limit for ${provider} (window: ${limit.window})`);
      this.log("show with: openagenthub limits");
    } finally {
      store.close();
    }
  }
}