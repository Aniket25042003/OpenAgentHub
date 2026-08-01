import { Command, Flags, Args } from "@oclif/core";
import { resolve } from "node:path";
import { loadManifestFromDir, checkAgentRequirements, detectRuntime, manifestToYaml } from "@openagenthub/sdk";

export default class Validate extends Command {
  static description = "Validate an agent manifest and check local runtime requirements";

  static args = { path: Args.string({ required: false, description: "project directory (default: .)" }) };

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Validate);
    const dir = resolve(args.path ?? ".");
    try {
      const { manifest, path } = loadManifestFromDir(dir);
      const detected = detectRuntime();
      const req = checkAgentRequirements(manifest, detected);

      if (flags.json) {
        this.logJson({ valid: true, manifestPath: path, manifest, requirements: req });
        return;
      }
      this.log(`manifest valid: ${manifest.name}@${manifest.version} (${path})`);
      this.log(`interfaces: ${Object.keys(manifest.interfaces).join(", ")}`);
      for (const msg of req.messages) this.log(`  ${req.satisfied ? "ok" : "warn"} ${msg}`);
      if (!req.satisfied) {
        this.log(`missing: ${req.missing.join(", ")}`);
        this.exit(1);
      }
    } catch (err) {
      if (flags.json) {
        this.logJson({ valid: false, error: (err as Error).message });
      } else {
        this.error(`invalid: ${(err as Error).message}`, { exit: 1 });
      }
    }
  }
}
