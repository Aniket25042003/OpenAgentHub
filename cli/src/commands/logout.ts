import { Command, Flags } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { resolveRegistryUrl, resolveToken, deleteCredential } from "../lib/credentials.js";
import { loadConfig, saveConfig } from "@openagenthub/runtime";

export default class Logout extends Command {
  static description = "Revoke the signed CLI session and remove the stored credential";

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
    all: Flags.boolean({ description: "revoke every CLI session on the account (remote)" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Logout);
    const registryUrl = resolveRegistryUrl(flags.registry);

    let revokedRemote = false;
    const token = resolveToken(registryUrl);
    if (token) {
      try {
        const client = new RegistryClient(registryUrl, token);
        if (flags.all) {
          const sessions = await client.mySessions();
          const cliIds = sessions.filter((s) => s.audience === "cli" && !s.revoked).map((s) => s.id);
          for (const id of cliIds) await client.revokeSession(id);
          this.log(`revoked ${cliIds.length} remote CLI session(s)`);
        } else {
          await client.logoutMe();
        }
        revokedRemote = true;
      } catch (err) {
        this.log(`registry unreachable; credential removed locally (${(err as Error).message})`);
      }
    }

    deleteCredential(registryUrl);
    const config = loadConfig();
    delete config.token;
    saveConfig(config);

    this.log(revokedRemote ? "signed out." : "signed out (local only).");
  }
}