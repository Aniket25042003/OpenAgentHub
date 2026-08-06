import { Command, Flags } from "@oclif/core";
import { statSync } from "node:fs";
import { controlInfo, daemonEnabled, initLogFollow, readLogFollow, readLogTail } from "../../lib/control-plane.js";

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
      let follow = initLogFollow(logPath);
      for (;;) {
        await new Promise((r) => setTimeout(r, 500));
        if (!this.exists(logPath)) return;
        const { next, line } = readLogFollow(logPath, follow);
        follow = next;
        if (line !== null) this.log(line);
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

