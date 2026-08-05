import { Command, Flags } from "@oclif/core";
import { statSync } from "node:fs";
import { controlInfo, daemonEnabled, logFilenames, readLogTail } from "../../lib/control-plane.js";

export default class Logs extends Command {
  static description = "Show the control plane daemon logs (newest last)";

  static flags = {
    lines: Flags.integer({ char: "n", default: 100, description: "number of lines to show" }),
    follow: Flags.boolean({ char: "f", description: "follow new log lines" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Logs);
    if (!daemonEnabled()) {
      this.error("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1", { exit: 1 });
    }
    const { logPath } = controlInfo();
    if (!this.exists(logPath)) {
      this.log("no control plane logs yet");
      return;
    }
    this.log(readLogTail(flags.lines));
    if (flags.follow) {
      let offset = statSync(logPath).size;
      for (;;) {
        await new Promise((r) => setTimeout(r, 500));
        const size = statSync(logPath).size;
        if (size > offset) {
          this.log(readLogTail(flags.lines));
          offset = size;
        }
      }
    }
  }

  private exists(p: string): boolean {
    try {
      statSync(p);
      return true;
    } catch {
      return false;
    }
  }
}
