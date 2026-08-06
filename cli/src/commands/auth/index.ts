import { Command, Flags } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { resolveRegistryUrl, resolveToken } from "../../lib/credentials.js";

export default class Auth extends Command {
  static description = "Show registry authentication summary (use 'auth status|sessions|revoke' for details)";

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Auth);
    const registryUrl = resolveRegistryUrl(flags.registry);
    const token = resolveToken(registryUrl);

    if (!token) {
      this.log("not signed in.");
      this.log("run: openagenthub login");
      return;
    }

    try {
      const client = new RegistryClient(registryUrl, token);
      const me = await client.me();
      const sessions = await client.mySessions();
      const active = sessions.filter((s) => !s.revoked).length;
      this.log(`account:  ${me.username} (${me.status}) @ ${registryUrl}`);
      this.log(`sessions: ${active} active / ${sessions.length} total`);
      this.log("");
      this.log("commands: openagenthub auth status    show account details");
      this.log("          openagenthub auth sessions  list sessions");
      this.log("          openagenthub auth revoke    revoke a session");
    } catch (err) {
      this.error(`registry unreachable at ${registryUrl}: ${(err as Error).message}`, { exit: 1 });
    }
  }
}