import { Command, Flags } from "@oclif/core";
import { systemSnapshot } from "@openagenthub/runtime";
import { printTable } from "../lib/print.js";

export default class Status extends Command {
  static description = "Snapshot of the system: OpenAgentHub agents, detected agents, and running containers";

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
    all: Flags.boolean({ char: "a", description: "include stopped containers" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const snap = await systemSnapshot({ allContainers: flags.all });
    if (flags.json) {
      this.logJson(snap);
      return;
    }

    const { host } = snap;
    this.log(`system: ${host.hostname} (${host.platform}/${host.arch}, ${host.cpus} cpu)`);
    this.log(
      `uptime: ${Math.floor(host.uptimeSec / 60)} min | memory: ${fmtBytes(host.memTotalBytes - host.memFreeBytes)} / ${fmtBytes(host.memTotalBytes)} | load: ${host.loadavg
        .map((n) => n.toFixed(2))
        .join(", ")}`,
    );
    this.log(`runtime: node ${host.node}${host.python ? ` | python ${host.python.replace("Python ", "")}` : ""}`);
    this.log(`docker: ${host.docker.available ? `available (${host.docker.version})` : "NOT available"}`);
    this.log(`registry: ${snap.openagenthub.registryUrl}`);
    this.log("");

    const installed = snap.openagenthub.installed;
    this.log(`OpenAgentHub installed agents (${installed.length}):`);
    if (installed.length === 0) {
      this.log("  (none)");
    } else {
      printTable(
        ["spec", "version", "trust", "installed"],
        installed.map((a) => [a.spec, a.version, a.trust, a.installedAt.slice(0, 10)]),
      );
    }
    this.log("");

    const detected = snap.agents.filter((a) => a.status !== "unknown");
    this.log(`Detected agents (${detected.length}):`);
    if (detected.length === 0) {
      this.log("  none detected (third-party agents are matched by known heuristics)");
    } else {
      printTable(
        ["agent", "status", "detected via", "pids", "containers", "config", "ports"],
        detected.map((a) => [
          a.displayName,
          a.status,
          a.detectedVia.join(","),
          a.processes.map((p) => p.pid).join(","),
          a.containerNames.join(","),
          a.configPaths.length > 0 ? "yes" : "",
          a.listeningPorts.join(","),
        ]),
      );
    }
    this.log("");

    const containers = snap.containers;
    this.log(`Containers (${containers.length}${flags.all ? " incl. stopped" : ""}):`);
    if (containers.length === 0) {
      this.log("  none");
    } else {
      printTable(
        ["id", "name", "image", "state", "ports", "agent"],
        containers.map((c) => [c.id.slice(0, 12), c.name, c.image, c.state, c.ports, c.matchedAgentId ?? c.managedBy ?? ""]),
      );
    }
  }
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.round(n / 1024)} KiB`;
}
