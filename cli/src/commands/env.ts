import { Command, Flags, Args } from "@oclif/core";
import { SecretsVault, loadConfig } from "@openagenthub/runtime";
import { parseSpec } from "../lib/installer.js";
import { resolveInstalledOrThrow } from "../lib/resolve.js";

export default class Env extends Command {
  static description = "Manage encrypted secrets for an agent (values never leave your machine)";

  static strict = false;

  static args = { spec: Args.string({ required: true, description: "namespace/name[@version]" }) };

  static flags = {
    delete: Flags.string({ description: "delete a secret key" }),
    reveal: Flags.string({ description: "print the value of a secret key (use with care)" }),
    passphrase: Flags.string({ description: "vault passphrase (or set AGENT_PASSPHRASE)" }),
  };

  async run(): Promise<void> {
    const { args, argv, flags } = await this.parse(Env);
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
    const [agentKey] = [match.key];

    let vault: SecretsVault;
    try {
      vault = SecretsVault.open({ passphrase: flags.passphrase ?? process.env.AGENT_PASSPHRASE });
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }

    const readSecrets = (): Record<string, string> => {
      try {
        return vault.get(agentKey);
      } catch (err) {
        this.error((err as Error).message, { exit: 1 });
        return {};
      }
    };

    if (flags.delete) {
      const current = readSecrets();
      if (!(flags.delete in current)) {
        this.error(`no secret named '${flags.delete}'`, { exit: 1 });
      }
      delete current[flags.delete];
      vault.set(agentKey, current);
      this.log(`deleted ${flags.delete} for ${agentKey}`);
      return;
    }

    if (flags.reveal) {
      const current = readSecrets();
      if (!(flags.reveal in current)) {
        this.error(`no secret named '${flags.reveal}'`, { exit: 1 });
      }
      this.log(current[flags.reveal]);
      return;
    }

    const kv = argv.slice(1) as string[];
    if (kv.length === 0) {
      const names = Object.keys(readSecrets());
      if (names.length === 0) {
        this.log(`no secrets stored for ${agentKey}`);
        return;
      }
      this.log(`secrets for ${agentKey}: ${names.join(", ")}`);
      this.log("(set a value with: openagenthub env <spec> KEY=VALUE)");
      return;
    }

    const values: Record<string, string> = {};
    for (const item of kv) {
      const eq = item.indexOf("=");
      if (eq <= 0) {
        this.error(`expected KEY=VALUE, got '${item}'`, { exit: 1 });
      }
      const key = item.slice(0, eq);
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        this.error(`invalid secret name '${key}': must match ^[A-Z][A-Z0-9_]*$`, { exit: 1 });
      }
      values[key] = item.slice(eq + 1);
    }
    vault.set(agentKey, values);
    this.log(`stored ${Object.keys(values).length} secret(s) for ${agentKey} (encrypted)`);
  }
}
