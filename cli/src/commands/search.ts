import { Command, Flags, Args } from "@oclif/core";
import { RegistryClient } from "@openagenthub/sdk";
import { loadConfig, REGISTRY_DEFAULT } from "@openagenthub/runtime";
import { printTable } from "../lib/print.js";

export default class Search extends Command {
  static description = "Search the agent registry";

  static args = { query: Args.string({ required: false, description: "search query" }) };

  static flags = {
    framework: Flags.string({ description: "filter by framework" }),
    tags: Flags.string({ description: "filter by tags (comma-separated)" }),
    models: Flags.string({ description: "filter by model provider" }),
    sort: Flags.string({ options: ["downloads", "trending", "newest"], default: "trending" }),
    registry: Flags.string({ description: "registry URL" }),
    limit: Flags.integer({ default: 20, description: "max results" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Search);
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    const registryUrl = flags.registry ?? config.registryUrl ?? REGISTRY_DEFAULT;
    const client = new RegistryClient(registryUrl, config.token);

    try {
      const items = await client.search({
        q: args.query,
        framework: flags.framework,
        tags: flags.tags,
        models: flags.models,
        sort: flags.sort as never,
        limit: flags.limit,
      });
      if (items.length === 0) {
        this.log("no agents found");
        return;
      }
      printTable(
        ["name", "version", "author", "framework", "models", "trust", "downloads"],
        items.map((a) => [
          `${a.namespace}/${a.name}`,
          a.version,
          a.author,
          a.framework ?? "",
          a.models.slice(0, 3).join(","),
          a.trust,
          a.downloads,
        ]),
      );
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
    }
  }
}
