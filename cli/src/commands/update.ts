import { Command, Flags, Args } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { loadConfig, REGISTRY_DEFAULT } from "@openagenthub/runtime";
import { installAgent } from "../lib/installer.js";

export default class Update extends Command {
  static description = "Update an installed agent to the latest version";

  static args = { spec: Args.string({ required: true, description: "namespace/name" }) };

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
    yes: Flags.boolean({ description: "auto-approve" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Update);
    const config = loadConfig();
    const registryUrl = flags.registry ?? config.registryUrl ?? REGISTRY_DEFAULT;
    const client = new RegistryClient(registryUrl, config.token);

    try {
      const [ns, name] = args.spec.split("/");
      const versions = await client.listVersions(ns, name);
      const latest = versions[versions.length - 1];
      this.log(`latest version of ${args.spec}: ${latest}`);
      await installAgent(`${args.spec}@${latest}`, { kind: "registry" }, { forceYes: flags.yes, noPermissions: false, registryUrl });
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
    }
  }
}
