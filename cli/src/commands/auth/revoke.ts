import { Command, Args, Flags } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { resolveRegistryUrl, resolveToken } from "../../lib/credentials.js";

export default class AuthRevoke extends Command {
  static description = "Revoke a session (list them with 'openagenthub auth sessions')";

  static args = { sessionId: Args.string({ required: true, description: "session id" }) };

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AuthRevoke);
    const registryUrl = resolveRegistryUrl(flags.registry);
    const token = resolveToken(registryUrl);

    if (!token) {
      this.error("not signed in (run: openagenthub login)", { exit: 1 });
      return;
    }

    const id = Number(args.sessionId);
    if (!Number.isInteger(id) || id <= 0) {
      this.error("session id must be a positive integer", { exit: 1 });
      return;
    }

    try {
      await new RegistryClient(registryUrl, token).revokeSession(id);
      this.log(`revoked session ${id}`);
    } catch (err) {
      this.error(`could not revoke session ${id}: ${(err as Error).message}`, { exit: 1 });
    }
  }
}