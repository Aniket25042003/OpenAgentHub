import { Command, Flags } from "@oclif/core";
import {
  CONTROL_BOUND_HOST,
  CONTROL_PROTOCOL_VERSION,
  daemonEnabled,
  daemonNeedsRestart,
  fetchControl,
  identityMatches,
  readState,
} from "../../lib/control-plane.js";

export default class Status extends Command {
  static description = "Show the local control plane status (daemon, port, health)";

  static flags = {
    json: Flags.boolean({ description: "output machine-readable JSON" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    const state = readState();
    if (!state) {
      this.log("control plane: not running");
      return;
    }
    if (state.health === "stopped") {
      this.log(`control plane: not running (stopped at ${state.startedAt})`);
      return;
    }
    const alive = identityMatches(state);
    const health = alive ? await fetchControl<{ status: string }>(state.port, "/api/local/v1/health") : null;
    if (flags.json) {
      this.logJson({
        running: alive && health?.status === "ok",
        pid: state.pid,
        port: state.port,
        health: health?.status ?? "unreachable",
        productVersion: state.productVersion,
        protocolVersion: state.protocolVersion,
        startedAt: state.startedAt,
        restartRequired: daemonNeedsRestart(state),
      });
      return;
    }
    if (!alive) {
      this.log(`control plane: STALE state (pid ${state.pid} not running)`);
      return;
    }
    this.log(`control plane: ${health?.status === "ok" ? "running" : "starting"}`);
    this.log(`  url: http://${CONTROL_BOUND_HOST}:${state.port}`);
    this.log(`  pid: ${state.pid}`);
    this.log(`  product version: ${state.productVersion} (protocol ${state.protocolVersion}/${CONTROL_PROTOCOL_VERSION})`);
    this.log(`  started at: ${state.startedAt}`);
    if (daemonNeedsRestart(state)) this.log("  restart required: product/protocol version changed");
  }
}
