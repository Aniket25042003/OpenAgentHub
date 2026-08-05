import { Command, Flags, Args } from "@oclif/core";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadManifestFromDir } from "@openagenthub/sdk";
import {
  AgentRuntime,
  SecretsVault,
  loadConfig,
  grantedPermissions,
  sandboxOverride,
  installedAgentDir,
  grantedSecretNames,
  saveSecretGrant,
} from "@openagenthub/runtime";
import { confirmAll } from "../lib/prompt.js";
import { checkRevocationBeforeRun, installedIsFresh } from "../lib/revocation.js";
import { parseSpec } from "../lib/installer.js";
import { installedMatches, resolveInstalledOrThrow } from "../lib/resolve.js";

export default class Run extends Command {
  static description = "Run an installed agent (CLI, MCP, or HTTP interface)";

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  static flags = {
    model: Flags.string({ description: "model provider, e.g. deepseek or openai:gpt-4o" }),
    interface: Flags.string({ options: ["cli", "mcp", "http"], default: "cli" }),
    input: Flags.string({ description: "JSON input passed to the agent on stdin" }),
    interactive: Flags.boolean({ description: "wire stdin/stdout to the terminal (MCP servers)" }),
    timeout: Flags.integer({ description: "timeout in ms", default: 120_000 }),
    "agent-home": Flags.string({ description: "override agent home directory" }),
    "allow-secrets": Flags.boolean({ description: "grant all requested secrets without prompting" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Run);
    if (flags["agent-home"]) process.env.AGENT_HOME = flags["agent-home"];

    const { namespace, name, version } = parseSpec(args.spec);

    let input = flags.input;
    if (input === undefined && !process.stdin.isTTY) {
      input = await new Promise<string>((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => (data += chunk));
        process.stdin.on("end", () => resolve(data));
      });
    }

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
      this.error(
        `${(err as Error).message} (run: openagenthub install ${namespace}/${name}${version ? `@${version}` : ""})`,
        { exit: 1 },
      );
      return;
    }
    const [agentKey, installed] = [match.key, match.record];
    if (!version && installedMatches(config, namespace, name).length > 1) {
      this.log(`note: multiple versions installed; running ${namespace}/${name}@${installed.version}`);
    }
    const dir = installedAgentDir({ namespace, name, version: installed.version });

    if (!existsSync(dir)) {
      this.error(`agent directory missing for ${agentKey} (reinstall with: openagenthub install ${namespace}/${name}@${installed.version})`, { exit: 1 });
    }

    const { manifest } = loadManifestFromDir(dir);

    const revCheck = await checkRevocationBeforeRun(
      agentKey,
      installed,
      config.registryUrl ?? "https://registry.openagenthub.dev",
      config.token,
    );
    if (revCheck.blocked) {
      this.error(`blocked: ${revCheck.blocked}`, { exit: 1 });
    }
    if (revCheck.staleWarning) {
      this.warn(revCheck.staleWarning);
      if (installed.trust !== "trusted" && installed.trust !== "local") {
        this.warn("status is stale; running with container isolation");
      }
    }

    const vault = SecretsVault.open();
    const requestedSecrets = (manifest.secrets ?? []) as string[];
    const vaultSecrets = vault.get(agentKey);
    const grantedSecrets = grantedSecretNames(agentKey, config);
    const toAsk = requestedSecrets.filter((s) => s in vaultSecrets && !grantedSecrets.has(s));

    if (toAsk.length > 0 && !flags["allow-secrets"]) {
      if (!process.stdin.isTTY) {
        this.warn(`not exposing stored secrets (${toAsk.join(", ")}) in non-interactive mode; pass --allow-secrets to grant them`);
      } else {
        const answers = await confirmAll(
          toAsk.map((s) => `expose stored secret '${s}' to ${manifest.name}?`),
          false,
        );
        toAsk.forEach((s, i) => {
          if (answers[i]) saveSecretGrant(config, agentKey, s);
        });
      }
    } else if (flags["allow-secrets"]) {
      for (const s of toAsk) saveSecretGrant(config, agentKey, s);
    }
    const exposedSecrets = requestedSecrets.filter((s) => grantedSecretNames(agentKey, config).has(s));

    const override = sandboxOverride(config, agentKey);
    const granted = Object.entries(grantedPermissions(config, agentKey))
      .filter(([, v]) => v)
      .map(([k]) => k)
      .filter((k) => k !== "none") as never[];

    const runtime = new AgentRuntime(vault);
    const iface = flags.interface as "cli" | "mcp" | "http";
    const result = await runtime.runAgent({
      agentDir: dir,
      manifest,
      agentKey,
      interfaceName: iface,
      input: input === "" ? undefined : input,
      granted,
      trustLevel: installed.trust,
      model: flags.model,
      timeoutMs: flags.timeout,
      interactive: flags.interactive,
      reviewStatus: installed.reviewStatus,
      statusFresh: revCheck.statusFresh && installedIsFresh(installed),
      sandboxOverride: override ?? null,
      archiveDigest: installed.archiveDigest,
    });

    if (result.sandboxReason) {
      this.log(`sandbox: ${result.sandbox} (${result.sandboxReason})`);
    }
    if (exposedSecrets.length > 0) {
      this.log(`exposed secrets: ${exposedSecrets.join(", ")}`);
    }

    if (flags.interactive) {
      this.exit(result.result.exitCode);
      return;
    }

    if (result.result.stdout) process.stdout.write(result.result.stdout);
    if (result.result.stderr) process.stderr.write(result.result.stderr);
    this.exit(result.result.exitCode);
  }
}
