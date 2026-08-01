import { Command, Flags, Args } from "@oclif/core";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadManifestFromDir } from "@openagenthub/sdk";
import { AgentRuntime, SecretsVault, loadConfig, grantedPermissions, installedAgentDir } from "@openagenthub/runtime";

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
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Run);
    if (flags["agent-home"]) process.env.AGENT_HOME = flags["agent-home"];

    const { namespace, name, version } = parseSpec(args.spec);
    const config = loadConfig();

    let input = flags.input;
    if (input === undefined && !process.stdin.isTTY) {
      input = await new Promise<string>((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => (data += chunk));
        process.stdin.on("end", () => resolve(data));
      });
    }

    const match = Object.entries(config.installed ?? {}).find(
      ([key]) =>
        key.startsWith(`${namespace}/${name}@`) && (version ? key === `${namespace}/${name}@${version}` : true),
    );
    if (!match) {
      this.error(`agent '${namespace}/${name}${version ? `@${version}` : ""}' is not installed (run: agent install ${namespace}/${name})`, { exit: 1 });
    }
    const [agentKey, installed] = match;
    const dir = installedAgentDir({ namespace, name, version: installed.version });

    if (!existsSync(dir)) {
      this.error(`agent directory missing for ${agentKey} (reinstall with: agent install ${namespace}/${name}@${installed.version})`, { exit: 1 });
    }

    const { manifest } = loadManifestFromDir(dir);
    const granted = grantedPermissions(config, agentKey);
    const vault = SecretsVault.open();

    const runtime = new AgentRuntime(vault);
    const iface = flags.interface as "cli" | "mcp" | "http";
    const result = await runtime.runAgent({
      agentDir: dir,
      manifest,
      agentKey,
      interfaceName: iface,
      input: input === "" ? undefined : input,
      granted: Object.entries(granted).filter(([, v]) => v).map(([k]) => k as never),
      trustLevel: installed.trust,
      model: flags.model,
      timeoutMs: flags.timeout,
      interactive: flags.interactive,
    });

    if (flags.interactive) {
      this.exit(result.result.exitCode);
      return;
    }

    if (result.result.stdout) process.stdout.write(result.result.stdout);
    if (result.result.stderr) process.stderr.write(result.result.stderr);
    this.exit(result.result.exitCode);
  }
}

function parseSpec(spec: string): { namespace: string; name: string; version?: string } {
  const m = spec.match(/^([a-z0-9][a-z0-9-]*[a-z0-9])\/([a-z0-9][a-z0-9_-]*[a-z0-9])(?:@(.*))?$/);
  if (!m) throw new Error(`invalid agent spec '${spec}'`);
  return { namespace: m[1], name: m[2], version: m[3] || undefined };
}
