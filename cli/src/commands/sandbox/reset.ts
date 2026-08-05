import { Command, Args } from "@oclif/core";
import { clearSandboxOverride, loadConfig } from "@openagenthub/runtime";
import { parseSpec } from "../../lib/installer.js";

export default class SandboxReset extends Command {
  static description = "Remove the sandbox override for an installed agent";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  async run(): Promise<void> {
    const { args } = await this.parse(SandboxReset);
    const { namespace, name, version } = parseSpec(args.spec);
    const config = loadConfig();
    const match = Object.entries(config.installed ?? {}).find(
      ([key]) =>
        key.startsWith(`${namespace}/${name}@`) && (version ? key === `${namespace}/${name}@${version}` : true),
    );
    if (!match) {
      this.error(`agent '${namespace}/${name}${version ? `@${version}` : ""}' is not installed`, { exit: 1 });
    }
    const [agentKey] = match;
    const changed = clearSandboxOverride(config, agentKey);
    if (!changed) {
      this.log(`no sandbox override exists for ${agentKey}`);
      return;
    }
    this.log(`sandbox override for ${agentKey} removed; effective sandbox is derived from policy again`);
  }
}
