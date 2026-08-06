import { Command, Flags, Args } from "@oclif/core";
import { openUsageStore, revokeProvider, setEnabled } from "@openagenthub/runtime";
import { isProvider, PROVIDER_NAMES } from "../../lib/integrations.js";

export default class IntegrationsDisable extends Command {
  static description = "Disable a third-party integration, revoke consent grants, and clear cached usage/limits for it";

  static args = {
    provider: Args.string({ required: true, description: `provider (${PROVIDER_NAMES.join(", ")})` }),
  };

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IntegrationsDisable);
    const provider = args.provider as string;
    if (!isProvider(provider)) {
      this.error(`unknown provider '${provider}' (expected one of: ${PROVIDER_NAMES.join(", ")})`, { exit: 1 });
    }
    const store = openUsageStore();
    try {
      const cleared = revokeProvider(store, provider);
      setEnabled(store, provider, false);
      if (flags.json) {
        this.logJson({ provider, enabled: false, removed: { usageEvents: cleared.usage, limitRows: cleared.limits } });
        return;
      }
      this.log(`disabled ${provider} integration.`);
      this.log(`  revoked consent, removed ${cleared.usage} cached usage event(s) and ${cleared.limits} limit row(s).`);
      this.log("  note: a stored API key (if any) is not deleted by this command; remove it with 'openagenthub integrations set-key --unset <provider>'");
    } finally {
      store.close();
    }
  }
}