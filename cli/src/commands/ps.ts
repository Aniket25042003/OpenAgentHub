import { Command, Flags } from "@oclif/core";
import { dockerVersion, listContainers } from "@openagenthub/runtime";
import { printTable } from "../lib/print.js";

export default class Ps extends Command {
  static description = "List Docker containers running on this machine";

  static flags = {
    all: Flags.boolean({ char: "a", description: "include stopped containers" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Ps);
    if (!dockerVersion()) {
      this.error("docker is not available", { exit: 1 });
    }
    const containers = listContainers({ all: flags.all });
    if (flags.json) {
      this.logJson(containers);
      return;
    }
    if (containers.length === 0) {
      this.log(flags.all ? "no containers (running or stopped)" : "no running containers");
      return;
    }
    printTable(
      ["id", "name", "image", "state", "status", "ports"],
      containers.map((c) => [c.id.slice(0, 12), c.name, c.image, c.state, c.status, c.ports]),
    );
  }
}
