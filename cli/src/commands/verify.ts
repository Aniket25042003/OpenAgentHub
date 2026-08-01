import { Command, Args } from "@oclif/core";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { verifySignatureFileStrict, readSignatureFile, loadManifestFromDir } from "@openagenthub/sdk";
import { loadConfig, installedAgentDir } from "@openagenthub/runtime";
import { parseSpec } from "../lib/installer.js";

export default class Verify extends Command {
  static description = "Verify the integrity and signature of an installed agent";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  async run(): Promise<void> {
    const { args } = await this.parse(Verify);
    const { namespace, name, version } = parseSpec(args.spec);
    const config = loadConfig();

    const rec = Object.entries(config.installed ?? {}).find(
      ([key]) => key.startsWith(`${namespace}/${name}@`) && (version ? key === `${namespace}/${name}@${version}` : true),
    );
    if (!rec) {
      this.error(`agent '${namespace}/${name}' is not installed`, { exit: 1 });
    }
    const [, agent] = rec;
    const dir = installedAgentDir({ namespace, name, version: agent.version });

    try {
      loadManifestFromDir(dir);
    } catch (err) {
      this.error(`manifest invalid: ${(err as Error).message}`, { exit: 1 });
    }

    const sigPath = join(dir, "signature.sig.json");
    const archivePath = join(dir, "archive.ahb");
    if (!existsSync(sigPath)) {
      this.log("warning: no signature file present (dev install); integrity of manifest verified");
      return;
    }
    if (!existsSync(archivePath)) {
      this.error("signature file present but archive.ahb is missing; cannot verify integrity", { exit: 1 });
    }

    const sig = await readSignatureFile(sigPath);
    try {
      verifySignatureFileStrict(sig, archivePath);
    } catch (err) {
      this.error(`signature verification FAILED: ${(err as Error).message}`, { exit: 1 });
    }
    this.log(`signature valid (publisher key ${sig.publicKeyId})`);
    this.log(`archive sha256: ${sig.sha256}`);
    this.log(`integrity ok: ${namespace}/${name}@${agent.version}`);
  }
}
