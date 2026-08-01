import { Command, Flags } from "@oclif/core";
import { loadConfig, saveConfig, REGISTRY_DEFAULT } from "@openagenthub/runtime";
import { RegistryClient } from "@openagenthub/sdk";

export default class Login extends Command {
  static description = "Authenticate with the registry using a GitHub token";

  static flags = {
    token: Flags.string({ char: "t", description: "GitHub personal access token" }),
    registry: Flags.string({ description: "registry URL", default: REGISTRY_DEFAULT }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    if (!flags.token) {
      this.error("no token provided. Pass one with --token (a GitHub personal access token)", { exit: 1 });
    }
    const config = loadConfig();
    config.registryUrl = flags.registry;
    config.token = flags.token;
    saveConfig(config);

    try {
      const client = new RegistryClient(flags.registry, flags.token);
      const me = await client.me();
      this.log(`authenticated as ${me.username} at ${flags.registry}`);
    } catch (err) {
      this.log(`token stored locally (registry ${flags.registry} not reachable: ${(err as Error).message})`);
    }
  }
}
