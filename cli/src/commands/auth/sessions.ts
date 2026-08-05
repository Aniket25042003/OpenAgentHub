import { Command, Flags } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { resolveRegistryUrl, resolveToken } from "../../lib/credentials.js";
import { printTable } from "../../lib/print.js";

export default class AuthSessions extends Command {
  static description = "List active sessions for the signed-in account";

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthSessions);
    const registryUrl = resolveRegistryUrl(flags.registry);
    const token = resolveToken(registryUrl);

    if (!token) {
      this.error("not signed in (run: openagenthub login)", { exit: 1 });
      return;
    }

    try {
      const sessions = await new RegistryClient(registryUrl, token).mySessions();
      if (flags.json) {
        this.logJson(sessions);
        return;
      }
      if (sessions.length === 0) {
        this.log("no sessions");
        return;
      }
      printTable(
        ["id", "audience", "device", "created", "last used", "expires", "state"],
        sessions.map((s) => [
          String(s.id),
          s.audience,
          s.deviceLabel ?? "",
          new Date(s.createdAt).toLocaleString(),
          new Date(s.lastUsedAt).toLocaleString(),
          new Date(s.expiresAt).toLocaleString(),
          s.revoked ? "revoked" : "active",
        ]),
      );
    } catch (err) {
      this.error(`could not list sessions at ${registryUrl}: ${(err as Error).message}`, { exit: 1 });
    }
  }
}