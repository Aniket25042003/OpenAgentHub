import { Command } from "@oclif/core";
import { loadConfig, grantedPermissions } from "@openagenthub/runtime";
import { printTable } from "../lib/print.js";

export default class List extends Command {
  static description = "List installed agents";

  async run(): Promise<void> {
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    const installed = Object.entries(config.installed ?? {});
    if (installed.length === 0) {
      this.log("no agents installed");
      return;
    }
    printTable(
      ["name", "version", "author", "trust", "installed"],
      installed.map(([key, a]) => {
        const perms = Object.entries(grantedPermissions(config, key))
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(",");
        return [`${a.namespace}/${a.name}`, a.version, a.author, a.trust, a.installedAt.slice(0, 10)];
      }),
    );
    this.log("");
    this.log("granted permissions:");
    for (const [key, a] of installed) {
      const perms = Object.entries(grantedPermissions(config, key))
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(",");
      if (perms) this.log(`  ${a.namespace}/${a.name}@${a.version}: ${perms}`);
    }
  }
}
