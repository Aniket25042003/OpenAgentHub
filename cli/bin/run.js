#!/usr/bin/env node
import { execute } from "@oclif/core";

const args = process.argv.slice(2);
if (args.length === 0 && process.env.OPENAGENTHUB_NO_DAEMON !== "1") {
  args.push("ui");
}
await execute({ dir: import.meta.url, args });
