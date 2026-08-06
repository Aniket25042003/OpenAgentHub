import { Command, Flags } from "@oclif/core";
import { openUsageStore, allIntegrationStatus, providerSource } from "@openagenthub/runtime";
import { printTable } from "../../lib/print.js";
import { PROVIDER_NAMES } from "../../lib/integrations.js";

export default class Integrations extends Command {
  static description = "Show third-party integration status (Claude Code, Codex, OpenCode)";

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Integrations);
    const store = openUsageStore();
    try {
      const status = allIntegrationStatus(store);
      if (flags.json) {
        this.logJson(
          status.map((s) => ({
            provider: s.provider,
            enabled: s.enabled,
            detected: s.detected,
            consent: { credentials: s.credentials, live: s.live },
            source: providerSource(s.provider),
          })),
        );
        return;
      }
      printTable(
        ["provider", "enabled", "detected", "credentials", "live", "data source"],
        status.map((s) => {
          const src = providerSource(s.provider);
          return [s.provider, s.enabled ? "yes" : "no", s.detected ? "yes" : "no", s.credentials ? "granted" : "-", s.live ? "granted" : "-", s.detected ? src.root : "none detected"];
        }),
      );
      this.log("");
      this.log("grant access with: openagenthub integrations enable <provider> [--credentials] [--live]");
      this.log("revoke with:       openagenthub integrations disable <provider>");
    } finally {
      store.close();
    }
  }
}