import { Command, Args } from "@oclif/core";
import { rmSync, existsSync } from "node:fs";
import { loadConfig, saveConfig, installedAgentDir, agentKeyToString } from "@openagenthub/runtime";
import { SecretsVault } from "@openagenthub/runtime";
import { parseSpec } from "../lib/installer.js";
import { installedMatches } from "../lib/resolve.js";

export default class Uninstall extends Command {
  static description = "Remove an installed agent";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  async run(): Promise<void> {
    const { args } = await this.parse(Uninstall);
    const { namespace, name, version } = parseSpec(args.spec);
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }

    let candidates = installedMatches(config, namespace, name);
    if (version) {
      candidates = candidates.filter((m) => m.record.version === version);
    }
    if (candidates.length === 0) {
      this.error(`agent '${namespace}/${name}${version ? `@${version}` : ""}' is not installed`, { exit: 1 });
    }
    if (candidates.length > 1 && !version) {
      const versions = candidates.map((m) => m.record.version).join(", ");
      this.error(
        `multiple versions of '${namespace}/${name}' are installed (${versions}); specify the version to remove: agent uninstall ${namespace}/${name}@<version>`,
        { exit: 1 },
      );
    }

    for (const { key, record } of candidates) {
      const dir = installedAgentDir({ namespace, name, version: record.version });
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      delete config.installed![key];
      delete config.permissions?.[key];
      this.log(`removed ${agentKeyToString({ namespace, name, version: record.version })}`);
    }
    saveConfig(config);

    const vault = SecretsVault.open();
    for (const { record } of candidates) {
      vault.delete(`${namespace}/${name}@${record.version}`);
    }
  }
}
