import { Command, Flags } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { loadConfig } from "@openagenthub/runtime";
import { resolveRegistryUrl, resolveToken } from "../../lib/credentials.js";
import { printTable } from "../../lib/print.js";

export default class AuthStatus extends Command {
  static description = "Inspect the signed-in registry account, sessions, and agreements";

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthStatus);    const registryUrl = resolveRegistryUrl(flags.registry);
    const token = resolveToken(registryUrl);

    if (!token) {
      this.log("not signed in (run: openagenthub login)");
      return;
    }

    try {
      const client = new RegistryClient(registryUrl, token);
      const me = await client.me();
      const agreements = await client.myAgreements().catch(() => ({ tos: "unknown", privacy: "unknown", publisher: "unknown" }));

      if (flags.json) {
        this.logJson({ username: me.username, registry: registryUrl, status: me.status, agreements });
        return;
      }

      this.log(`account:        ${me.username}`);
      this.log(`registry:       ${registryUrl}`);
      this.log(`status:         ${me.status}`);
      this.log(`tos:            ${agreements.tos}`);
      this.log(`privacy:        ${agreements.privacy}`);
      this.log(`publisher:      ${agreements.publisher}`);
      this.log("");
      this.log("use 'openagenthub auth sessions' to list active sessions and 'openagenthub auth revoke <id>' to revoke one.");
    } catch (err) {
      this.error(`authentication failed at ${registryUrl}: ${(err as Error).message}`, { exit: 1 });
    }
  }
}