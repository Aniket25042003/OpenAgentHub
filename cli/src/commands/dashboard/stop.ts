import { Command } from "@oclif/core";
import { clearState, daemonEnabled, readState, stopDaemon } from "../../lib/control-plane.js";

export default class Stop extends Command {
  static description = "Stop the local control plane daemon";

  async run(): Promise<void> {
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    const state = readState();
    if (!state) {
      this.log("control plane is not running");
      return;
    }
    const stopped = await stopDaemon();
    if (stopped) {
      this.log(`control plane stopped (pid ${state.pid})`);
    } else {
      this.log(`pid ${state.pid} is stale; cleared control-plane state`);
      clearState();
    }
  }
}
