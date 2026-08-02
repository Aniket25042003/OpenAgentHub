import { Command, Flags } from "@oclif/core";
import { dockerVersion, isOahContainer, listContainers } from "@openagenthub/runtime";
import { printTable } from "../lib/print.js";

export default class Ps extends Command {
  static description = "List OpenAgentHub sandbox containers (--all for every container on the machine)";

  static flags = {
    all: Flags.boolean({ char: "a", description: "list every container (running and stopped)" }),
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Ps);
    if (!dockerVersion()) {
      this.error("docker is not available", { exit: 1 });
    }
    const all = listContainers({ all: flags.all });
    const containers = flags.all ? all : all.filter(isOahContainer);
    if (flags.json) {
      this.logJson(containers);
      return;
    }
    if (containers.length === 0) {
      this.log(flags.all ? "no containers (running or stopped)" : "no OpenAgentHub containers running");
      return;
    }
    printTable(
      ["id", "name", "image", "state", "status", "ports"],
      containers.map((c) => [c.id.slice(0, 12), c.name, c.image, c.state, c.status, c.ports]),
    );
  }
}
