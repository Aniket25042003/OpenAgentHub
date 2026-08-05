import { Command, Args, Flags } from "@oclif/core";
import { readRun, readRunLogTail, runLogPath } from "../lib/supervisor.js";
import { closeSync, openSync, readSync, statSync } from "node:fs";

export default class Logs extends Command {
  static description = "Show or follow logs for a run";

  static args = { runId: Args.string({ required: true, description: "run id (see 'openagenthub ps')" }) };

  static flags = {
    n: Flags.integer({ char: "n", description: "number of tail lines", default: 100 }),
    follow: Flags.boolean({ char: "f", description: "keep streaming new log lines" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Logs);
    const record = readRun(args.runId);
    if (!record) {
      this.error(`run ${args.runId} not found (see 'openagenthub history')`, { exit: 1 });
      return;
    }

    const tail = readRunLogTail(args.runId, flags.n);
    if (tail) process.stdout.write(tail.endsWith("\n") ? tail : `${tail}\n`);
    if (!flags.follow) return;

    const logPath = runLogPath(args.runId);
    let size = exists(logPath) ? statSync(logPath).size : 0;
    while (true) {
      await new Promise((r) => setTimeout(r, 500));
      if (!exists(logPath)) break;
      const current = statSync(logPath).size;
      if (current < size) {
        size = 0;
        continue;
      }
      if (current > size) {
        const fd = openSync(logPath, "r");
        try {
          const buf = Buffer.alloc(current - size);
          readSync(fd, buf, 0, buf.length, size);
          process.stdout.write(buf.toString());
        } finally {
          closeSync(fd);
        }
        size = current;
      }
    }
  }
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
