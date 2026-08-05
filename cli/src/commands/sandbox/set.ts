import { Command, Args, Flags } from "@oclif/core";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  loadConfig,
  setSandboxOverride,
  installedAgentDir,
  type InstalledAgent,
} from "@openagenthub/runtime";
import { parseSpec } from "../../lib/installer.js";

export default class SandboxSet extends Command {
  static description = "Set a digest-bound sandbox override for an installed agent";

  static args = {
    spec: Args.string({ required: true, description: "namespace/name[@version]" }),
    sandbox: Args.string({ required: true, options: ["container", "process"], description: "sandbox mode" }),
  };

  static flags = {
    "acknowledge-risk": Flags.boolean({
      description: "acknowledge the risk of running an agent in a host process (required for process)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SandboxSet);
    const { namespace, name, version } = parseSpec(args.spec);
    const config = loadConfig();
    const match = Object.entries(config.installed ?? {}).find(
      ([key]) =>
        key.startsWith(`${namespace}/${name}@`) && (version ? key === `${namespace}/${name}@${version}` : true),
    );
    if (!match) {
      this.error(`agent '${namespace}/${name}${version ? `@${version}` : ""}' is not installed`, { exit: 1 });
    }
    const [agentKey, installed] = match as [string, InstalledAgent];
    const dir = installedAgentDir({ namespace, name, version: installed.version });

    if (args.sandbox === "process") {
      if (installed.trust !== "trusted" && installed.trust !== "local") {
        this.error(`process override is only allowed for trusted or local agents (this agent is '${installed.trust}')`, {
          exit: 1,
        });
      }
      if (!flags["acknowledge-risk"]) {
        this.error(
          "running an agent in a host process removes container isolation; pass --acknowledge-risk to confirm",
          { exit: 1 },
        );
      }
    }

    const archivePath = join(dir, "archive.ahb");
    let digest: string;
    if (existsSync(archivePath)) {
      digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
    } else if (installed.trust === "local") {
      digest = "local";
    } else {
      this.error(`cannot compute archive digest for ${agentKey}; reinstall the agent first`, { exit: 1 });
    }

    setSandboxOverride(config, agentKey, args.sandbox as "container" | "process", digest);
    this.log(
      `sandbox override for ${agentKey} set to '${args.sandbox}' (bound to archive digest ${digest.slice(0, 12)}…)`,
    );
    this.log("note: the override resets automatically when the agent is updated to a new digest");
  }
}
