import { Command, Args } from "@oclif/core";
import { autostartDisable, autostartEnable, autostartStatus, daemonEnabled } from "../../lib/control-plane.js";

export default class Autostart extends Command {
  static description = "Start the control plane automatically at login (launchd / systemd-user)";

  static args = {
    action: Args.string({ name: "action", required: true, options: ["on", "off", "status"], description: "on | off | status" }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Autostart);
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    if (args.action === "on") {
      await autostartEnable();
      this.log("control plane autostart enabled (launchd/systemd-user)");
      return;
    }
    if (args.action === "off") {
      await autostartDisable();
      this.log("control plane autostart disabled");
      return;
    }
    const status = await autostartStatus();
    this.log(status.enabled ? `autostart enabled (${status.path})` : "autostart disabled");
  }
}
