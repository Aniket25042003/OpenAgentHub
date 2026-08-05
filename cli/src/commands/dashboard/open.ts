import { Command } from "@oclif/core";
import { CONTROL_BOUND_HOST, daemonEnabled, ensureDaemon, openUrl } from "../../lib/control-plane.js";

export default class Open extends Command {
  static description = "Start the local control plane if needed and open the dashboard in the browser";

  async run(): Promise<void> {
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    const { state, started } = await ensureDaemon();
    const url = `http://${CONTROL_BOUND_HOST}:${state.port}`;
    await openUrl(url);
    this.log(started ? `control plane started: ${url}` : `control plane running: ${url}`);
  }
}
