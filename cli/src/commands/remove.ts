import { Command, Args } from "@oclif/core";
import { readRun, removeRun, runIsActive } from "../lib/supervisor.js";

export default class Remove extends Command {
  static description = "Remove a run record and its logs from history (does not uninstall the agent)";

  static args = { runId: Args.string({ required: true, description: "run id (see 'openagenthub history')" }) };

  async run(): Promise<void> {
    const { args } = await this.parse(Remove);
    const record = readRun(args.runId);
    if (!record) {
      this.error(`run ${args.runId} not found (see 'openagenthub history')`, { exit: 1 });
      return;
    }
    if (runIsActive(record)) {
      this.error(`run ${args.runId} is ${record.state}; stop it first with 'openagenthub stop ${args.runId}'`, { exit: 1 });
      return;
    }
    removeRun(args.runId);
    this.log(`run ${args.runId} removed from history`);
  }
}
