import { Command, Flags, Args } from "@oclif/core";
import { SecretsVault } from "@openagenthub/runtime";
import { storeIntegrationKey, clearIntegrationKey } from "@openagenthub/runtime";
import { isProvider, PROVIDER_NAMES } from "../../lib/integrations.js";

const KEY_ENV: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
  opencode: "OPENAI_API_KEY",
};

export default class IntegrationsSetKey extends Command {
  static description = "Store an API key for a live usage endpoint in the machine-bound secret vault (claude: ANTHROPIC_API_KEY; codex/opencode: OPENAI_API_KEY)";

  static args = {
    provider: Args.string({ required: true, description: `provider (${PROVIDER_NAMES.join(", ")})` }),
    key: Args.string({ required: false, description: "API key value (omit to read from stdin)" }),
  };

  static flags = {
    unset: Flags.boolean({ description: "remove the stored key for this provider instead of setting one" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IntegrationsSetKey);
    const provider = args.provider as string;
    if (!isProvider(provider)) {
      this.error(`unknown provider '${provider}' (expected one of: ${PROVIDER_NAMES.join(", ")})`, { exit: 1 });
    }
    const env = KEY_ENV[provider];
    const vault = SecretsVault.open();
    if (flags.unset) {
      clearIntegrationKey(vault, env);
      if (flags.json) {
        this.logJson({ provider, env, stored: false });
        return;
      }
      this.log(`removed stored ${env} key for ${provider}.`);
      return;
    }
    let key: string | undefined = args.key;
    if (key === undefined) {
      if (process.stdin.isTTY) this.error("supply the key as an argument or pipe it via stdin", { exit: 1 });
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      key = Buffer.concat(chunks).toString("utf8").trim();
    }
    if (!key || key.length < 10) {
      this.error("refusing to store a key shorter than 10 characters", { exit: 1 });
    }
    storeIntegrationKey(vault, env, key);
    if (flags.json) {
      this.logJson({ provider, env, stored: true });
      return;
    }
    this.log(`stored ${env} key for ${provider} in the machine vault (never logged, never leaves this machine).`);
    this.log(`now grant live-access consent and collect: openagenthub integrations enable ${provider} --live`);
  }
}