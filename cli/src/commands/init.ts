import { Command, Flags, Args } from "@oclif/core";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { assertValidManifest, parseManifest, manifestToYaml } from "@openagenthub/sdk";
import { loadConfig } from "@openagenthub/runtime";

export default class Init extends Command {
  static description = "Scaffold a new agent project with an agent.yaml manifest";

  static args = { name: Args.string({ required: true, description: "namespace/name of the agent" }) };

  static flags = {
    dir: Flags.string({ char: "d", description: "target directory (default: ./<name>)" }),
    python: Flags.boolean({ description: "scaffold a python agent" }),
    node: Flags.boolean({ description: "scaffold a node agent" }),
    force: Flags.boolean({ description: "overwrite existing files" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);
    const config = loadConfig();
    const user = userInfo().username ?? "local";
    const name = args.name.includes("/") ? args.name : `${user}/${args.name}`;

    const target = resolve(flags.dir ?? `./${name.split("/")[1]}`);
    mkdirSync(target, { recursive: true });

    const files = this.templates(name, flags.python ? "python" : flags.node ? "node" : "python");
    for (const [path, content] of Object.entries(files)) {
      const dest = join(target, path);
      if (!flags.force && existsSync(dest)) {
        this.error(`${dest} already exists (use --force to overwrite)`, { exit: 1 });
      }
      mkdirSync(join(target, path.split("/").slice(0, -1).join("/")), { recursive: true });
      writeFileSync(dest, content);
    }
    this.log(`created agent project at ${target}`);
    this.log(`run 'agent validate ${target}' to verify the manifest`);
  }

  private templates(name: string, lang: "python" | "node"): Record<string, string> {
    const manifest = {
      manifestVersion: 1,
      name,
      version: "0.1.0",
      author: userOrPlaceholder(),
      description: "A new OpenAgentHub agent",
      license: "MIT",
      runtime: { language: lang },
      models: { supported: ["openai", "anthropic", "ollama", "deepseek", "google", "local"] },
      interfaces:
        lang === "node"
          ? { cli: { command: "node index.js", input: "json", output: "json" } }
          : { cli: { command: "python app.py", input: "json", output: "json" } },
      permissions: [],
      dependencies: {},
      tags: ["agent"],
    };
    assertValidManifest(parseManifest(manifestToYaml(manifest as never)));

    const source =
      lang === "node"
        ? `#!/usr/bin/env node
// Read input as JSON from stdin
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const args = input.trim() ? JSON.parse(input) : {};
  console.log(JSON.stringify({ ok: true, hello: args.name ?? "world" }));
});
`
        : `import sys, json

def main():
    data = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    print(json.dumps({"ok": True, "hello": data.get("name", "world")}))

if __name__ == "__main__":
    main()
`;

    return {
      "agent.yaml": manifestToYaml(manifest as never) + "\n",
      [lang === "node" ? "index.js" : "app.py"]: source,
      "README.md": `# ${name}\n\nAn agent published to OpenAgentHub.\n`,
      ".gitignore": `node_modules/\n.venv/\n__pycache__/\ndist/\n`,
    };
  }
}

function userOrPlaceholder(): string {
  try {
    return userInfo().username;
  } catch {
    return "you";
  }
}
