import { Command, Flags, Args } from "@oclif/core";
import { installAgent } from "../lib/installer.js";

export default class Install extends Command {
  static description = "Install an agent from the registry, a signed archive, or a local directory";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  static flags = {
    file: Flags.string({ description: "install from a local .ahb archive" }),
    dir: Flags.string({ description: "install from a local project directory (dev mode)" }),
    registry: Flags.string({ description: "registry URL" }),
    yes: Flags.boolean({ description: "auto-approve permissions and runtime warnings" }),
    "no-permissions": Flags.boolean({ description: "deny all requested permissions" }),
    force: Flags.boolean({ description: "reinstall even if already present" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Install);
    const source = flags.file
      ? { kind: "file" as const, path: flags.file }
      : flags.dir
        ? { kind: "dir" as const, path: flags.dir }
        : { kind: "registry" as const };
    try {
      await installAgent(args.spec, source, {
        forceYes: flags.yes,
        noPermissions: Boolean(flags["no-permissions"]),
        registryUrl: flags.registry,
      });
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
    }
  }
}
