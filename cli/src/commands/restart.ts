import { Command, Args, Flags } from "@oclif/core";
import { prepareRunContext } from "../lib/run-agent.js";
import { allocatePort, readRun, restartRun, waitForRunStart } from "../lib/supervisor.js";

export default class Restart extends Command {
  static description = "Restart a managed (detached) run after rechecking revocation and sandbox policy";

  static args = { runId: Args.string({ required: true, description: "run id (see 'openagenthub ps')" }) };

  static flags = {
    input: Flags.string({ description: "JSON input passed to the agent on stdin (not stored; re-supply on restart)" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Restart);
    const existing = readRun(args.runId);
    if (!existing) {
      this.error(`run ${args.runId} not found (see 'openagenthub history')`, { exit: 1 });
      return;
    }

    const at = existing.agentKey.lastIndexOf("@");
    const slash = existing.agentKey.lastIndexOf("/");
    let ctx;
    try {
      ctx = await prepareRunContext(
        { namespace: existing.agentKey.slice(0, slash), name: existing.agentKey.slice(slash + 1, at), version: existing.agentKey.slice(at + 1) },
        {},
      );
    } catch (err) {
      this.error(`restart blocked: ${(err as Error).message}`, { exit: 1 });
      return;
    }

    const port = existing.interfaceName === "http" ? (existing.port ?? (await allocatePort())) : undefined;
    try {
      const { record } = await restartRun({
        runId: args.runId,
        agentKey: ctx.agentKey,
        version: ctx.version,
        interfaceName: existing.interfaceName,
        sandbox: ctx.installed.trust === "trusted" || ctx.installed.trust === "local" ? "process" : "container",
        port,
        timeoutMs: existing.timeoutMs,
        digest: ctx.installed.archiveDigest,
        input: flags.input,
      });
      const started = await waitForRunStart(args.runId);
      if (started.state === "failed") {
        this.error(`run ${args.runId} failed to start; see 'openagenthub logs ${args.runId}'`, { exit: 1 });
        return;
      }
      this.log(`run ${args.runId} restarted (pid ${record.pid})`);
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
    }
  }
}
