import { Command, Args } from "@oclif/core";
import { clearSandboxOverride, loadConfig } from "@openagenthub/runtime";
import { parseSpec } from "../../lib/installer.js";
import { resolveInstalledOrThrow } from "../../lib/resolve.js";

export default class SandboxReset extends Command {
  static description = "Remove the sandbox override for an installed agent";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  async run(): Promise<void> {
    const { args } = await this.parse(SandboxReset);
    const { namespace, name, version } = parseSpec(args.spec);
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    let match;
    try {
      match = resolveInstalledOrThrow(config, namespace, name, version);
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    const agentKey = match.key;
    const changed = clearSandboxOverride(config, agentKey);
    if (!changed) {
      this.log(`no sandbox override exists for ${agentKey}`);
      return;
    }
    this.log(`sandbox override for ${agentKey} removed; effective sandbox is derived from policy again`);
  }
}
