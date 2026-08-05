import { Command } from "@oclif/core";
import { CONTROL_BOUND_HOST, daemonEnabled, ensureDaemon, openUrl } from "../lib/control-plane.js";

export default class Ui extends Command {
  static description = "Start the local control plane and open the dashboard (default command)";

  async run(): Promise<void> {
    if (!daemonEnabled()) {
      this.log("run `openagenthub --help` for the full command list");
      return;
    }
    const { state, started } = await ensureDaemon();
    const url = `http://${CONTROL_BOUND_HOST}:${state.port}`;
    await openUrl(url);
    this.log(started ? `control plane started: ${url}` : `control plane running: ${url}`);
  }
}
