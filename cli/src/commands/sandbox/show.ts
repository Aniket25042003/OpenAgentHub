import { Command, Args } from "@oclif/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifestFromDir } from "@openagenthub/sdk";
import {
  loadConfig,
  sandboxOverride,
  installedAgentDir,
  effectiveSandbox,
  requestedSandbox,
} from "@openagenthub/runtime";
import { checkRevocationBeforeRun, installedIsFresh } from "../../lib/revocation.js";
import { parseSpec } from "../../lib/installer.js";

export default class SandboxShow extends Command {
  static description = "Show the effective sandbox decision for an installed agent";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(SandboxShow);
    const { namespace, name, version } = parseSpec(args.spec);
    const config = loadConfig();
    const match = Object.entries(config.installed ?? {}).find(
      ([key]) =>
        key.startsWith(`${namespace}/${name}@`) && (version ? key === `${namespace}/${name}@${version}` : true),
    );
    if (!match) {
      this.error(`agent '${namespace}/${name}${version ? `@${version}` : ""}' is not installed`, { exit: 1 });
    }
    const [agentKey, installed] = match;
    const dir = installedAgentDir({ namespace, name, version: installed.version });
    if (!existsSync(dir)) {
      this.error(`agent directory missing for ${agentKey} (reinstall first)`, { exit: 1 });
    }
    const { manifest } = loadManifestFromDir(dir);

    const revCheck = await checkRevocationBeforeRun(
      agentKey,
      installed,
      config.registryUrl ?? "https://registry.openagenthub.dev",
      config.token,
    );
    const statusFresh = revCheck.statusFresh && installedIsFresh(installed);
    if (revCheck.staleWarning) this.warn(revCheck.staleWarning);
    if (revCheck.blocked) this.warn(`blocked: ${revCheck.blocked}`);

    const override = sandboxOverride(config, agentKey);
    const decision = effectiveSandbox({
      trust: installed.trust,
      manifest,
      reviewStatus: installed.reviewStatus,
      statusFresh,
      override: override ?? null,
      archiveDigest: installed.archiveDigest,
    });

    this.log("sandbox decision:");
    this.log(`  source trust:        ${installed.trust}`);
    this.log(`  review status:       ${installed.reviewStatus ?? "unknown"}${statusFresh ? " (fresh)" : " (stale/unknown)"}`);
    this.log(`  requested sandbox:   ${requestedSandbox(manifest)}`);
    this.log(
      `  local override:      ${override ? `${override.sandbox} (digest ${override.digest.slice(0, 12)}…, set ${override.setAt.slice(0, 10)})` : "none"}`,
    );
    this.log(`  effective sandbox:   ${decision.blocked ? "blocked" : decision.mode}`);
    this.log(`  reason:              ${decision.blocked ?? decision.reason}`);
  }
}
