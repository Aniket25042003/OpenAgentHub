import { Command } from "@oclif/core";
import { CONTROL_BOUND_HOST, daemonEnabled, restartDaemon } from "../../lib/control-plane.js";

export default class Restart extends Command {
  static description = "Restart the local control plane daemon";

  async run(): Promise<void> {
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    const { state, started } = await restartDaemon();
    this.log(
      started
        ? `control plane restarted: http://${CONTROL_BOUND_HOST}:${state.port} (pid ${state.pid})`
        : `control plane already running: http://${CONTROL_BOUND_HOST}:${state.port} (pid ${state.pid})`,
    );
  }
}
