import { Command, Flags, Args } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { loadConfig, REGISTRY_DEFAULT } from "@openagenthub/runtime";
import { installAgent } from "../lib/installer.js";

export default class Update extends Command {
  static description = "Update an installed agent to the latest published version";

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
      const detail = await client.getVersion(ns, name, "latest");
      this.log(`latest version of ${args.spec}: ${detail.manifest.version}`);
      await installAgent(`${args.spec}@${detail.manifest.version}`, { kind: "registry" }, {
        forceYes: flags.yes,
        noPermissions: false,
        registryUrl,
        force: true,
      });
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
    }
  }
}
