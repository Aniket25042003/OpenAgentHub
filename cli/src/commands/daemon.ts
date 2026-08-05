import { Command } from "@oclif/core";
import { runDaemon } from "../lib/control-plane.js";

export default class Daemon extends Command {
  static hidden = true;
  static description = "Run the local control-plane daemon (dashboard + local API; started automatically)";

  async run(): Promise<void> {
    await runDaemon();
  }
}
