import { Command, Args } from "@oclif/core";
import { rmSync, existsSync } from "node:fs";
import { loadConfig, saveConfig, installedAgentDir, agentKeyToString } from "@openagenthub/runtime";
import { SecretsVault } from "@openagenthub/runtime";
import { parseSpec } from "../lib/installer.js";

export default class Uninstall extends Command {
  static description = "Remove an installed agent";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  async run(): Promise<void> {
    const { args } = await this.parse(Uninstall);
    const { namespace, name, version } = parseSpec(args.spec);
    const config = loadConfig();

    const candidates = Object.entries(config.installed ?? {}).filter(([key]) => {
      if (!key.startsWith(`${namespace}/${name}`)) return false;
      if (version) return key === `${namespace}/${name}@${version}`;
      return true;
    });

    if (candidates.length === 0) {
      this.error(`agent '${namespace}/${name}' is not installed`, { exit: 1 });
    }

    for (const [key, rec] of candidates) {
      const dir = installedAgentDir({ namespace, name, version: rec.version });
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      delete config.installed![key];
      delete config.permissions?.[key];
      this.log(`removed ${agentKeyToString({ namespace, name, version: rec.version })}`);
    }
    saveConfig(config);

    const vault = SecretsVault.open();
    for (const [, rec] of candidates) {
      vault.delete(`${namespace}/${name}@${rec.version}`);
    }
  }
}
