import { Command } from "@oclif/core";
import { CONTROL_BOUND_HOST, daemonEnabled, ensureDaemon } from "../../lib/control-plane.js";

export default class Start extends Command {
  static description = "Start the local control plane (dashboard daemon) without opening a browser";

  async run(): Promise<void> {
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    const { state, started } = await ensureDaemon();
    this.log(
      started
        ? `control plane started: http://${CONTROL_BOUND_HOST}:${state.port} (pid ${state.pid}, v${state.productVersion})`
        : `control plane already running: http://${CONTROL_BOUND_HOST}:${state.port} (pid ${state.pid})`,
    );
  }
}
