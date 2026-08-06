import { Command, Args } from "@oclif/core";
import { readRun, stopRun, type RunRecord } from "../lib/supervisor.js";

export default class Stop extends Command {
  static description = "Stop a managed (detached) run (graceful, then forced)";

  static args = { runId: Args.string({ required: true, description: "run id (see 'openagenthub ps')" }) };

  async run(): Promise<void> {
    const { args } = await this.parse(Stop);
    const before = readRun(args.runId);
    if (!before) {
      this.error(`run ${args.runId} not found (see 'openagenthub history')`, { exit: 1 });
      return;
    }
    let result: { stopped: boolean; record: RunRecord };
    try {
      result = await stopRun(args.runId);
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    if (!result.stopped) {
      this.error(`run ${args.runId} did not stop in time; check 'openagenthub logs ${args.runId}'`, { exit: 1 });
      return;
    }
    const reason = result.record.exitReason ?? "manual-stop";
    this.log(`run ${args.runId} stopped (${reason})`);
  }
}
