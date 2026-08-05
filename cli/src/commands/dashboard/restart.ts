import { Command } from "@oclif/core";
import { CONTROL_BOUND_HOST, daemonEnabled, restartDaemon } from "../../lib/control-plane.js";

export default class Restart extends Command {
  static description = "Restart the local control plane daemon";

  async run(): Promise<void> {
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    let result;
    try {
      result = await restartDaemon();
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    const { state, started } = result;
    this.log(
      started
        ? `control plane restarted: http://${CONTROL_BOUND_HOST}:${state.port} (pid ${state.pid})`
        : `control plane was not restarted; pid ${state.pid} is still serving http://${CONTROL_BOUND_HOST}:${state.port}`,
    );
  }
}
