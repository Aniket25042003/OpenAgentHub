import { Command } from "@oclif/core";
import { detectRuntime } from "@openagenthub/sdk";
import { printTable } from "../lib/print.js";

export default class RuntimeCommand extends Command {
  static description = "Detect local runtimes and tooling";

  async run(): Promise<void> {
    const r = detectRuntime();
    printTable(
      ["component", "status", "version"],
      [
        ["python3", r.python ? "ok" : "missing", r.python ?? "-"],
        ["node", r.node ? "ok" : "missing", r.node ?? "-"],
        ["docker", r.docker ? "ok" : "missing", r.dockerVersion ?? "-"],
        ["ollama", r.ollama ? "ok" : "missing", "-"],
        ["uv", r.uv ? "ok" : "missing", "-"],
        ["git", r.git ? "ok" : "missing", "-"],
      ],
    );
  }
}
