import { Command, Flags } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { resolveRegistryUrl, resolveToken } from "../lib/credentials.js";
import { loadConfig } from "@openagenthub/runtime";

export default class Whoami extends Command {
  static description = "Show the signed-in registry account";

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Whoami);
    const registryUrl = resolveRegistryUrl(flags.registry);
    const token = resolveToken(registryUrl);

    if (!token) {
      this.log("not signed in (run: openagenthub login)");
      return;
    }

    try {
      const me = await new RegistryClient(registryUrl, token).me();
      this.log(`${me.username} @ ${registryUrl}`);
      this.log(`status: ${me.status}`);
      if (me.status !== "active") this.log("(account suspended — publishing is disabled)");
    } catch (err) {
      this.error(`not authenticated at ${registryUrl}: ${(err as Error).message}`, { exit: 1 });
    }
  }
}