import { Command, Flags, Args } from "@oclif/core";
import { openUsageStore, providerSource, experimentalEnabled } from "@openagenthub/runtime";
import { setEnabled, setConsent } from "@openagenthub/runtime";
import { isProvider, PROVIDER_NAMES } from "../../lib/integrations.js";

export default class IntegrationsEnable extends Command {
  static description = "Enable a third-party integration and grant consent to read local usage data (and/or live usage endpoints)";

  static args = {
    provider: Args.string({ required: true, description: `provider (${PROVIDER_NAMES.join(", ")})` }),
  };

  static flags = {
    credentials: Flags.boolean({ description: "grant consent to read local credential-file data (sessions, token counts, plan limits)" }),
    live: Flags.boolean({ description: "grant consent to query the provider's live usage API (requires an API key via 'openagenthub integrations set-key')" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IntegrationsEnable);
    const provider = args.provider as string;
    if (!isProvider(provider)) {
      this.error(`unknown provider '${provider}' (expected one of: ${PROVIDER_NAMES.join(", ")})`, { exit: 1 });
    }
    if (!flags.credentials && !flags.live) {
      this.error("choose what to enable: pass --credentials and/or --live", { exit: 1 });
    }
    if (flags.live && provider === "claude" && !experimentalEnabled()) {
      this.log("note: the live endpoint for claude is experimental; set OPENAGENTHUB_EXPERIMENTAL=1 to use it");
    }
    const store = openUsageStore();
    try {
      setEnabled(store, provider, true);
      if (flags.credentials) setConsent(store, provider, "credentials", true);
      if (flags.live) setConsent(store, provider, "live", true);
      if (flags.json) {
        this.logJson({ provider, enabled: true, credentials: flags.credentials ?? false, live: flags.live ?? false });
        return;
      }
      this.log(`enabled ${provider} integration.`);
      const src = providerSource(provider);
      this.log("  local data source:");
      this.log(`    ${src.root}`);
      for (const f of src.files) this.log(`    reads: ${f}`);
      for (const e of src.endpoints) this.log(`    calls: ${e}`);
      this.log("  collected values are stored in the local agent store and never leave this machine.");
      this.log("show current state with: openagenthub integrations");
    } finally {
      store.close();
    }
  }
}