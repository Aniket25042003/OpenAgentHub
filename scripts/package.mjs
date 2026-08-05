#!/usr/bin/env node
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "cli");
const WEB = join(ROOT, "web");
const STANDALONE = join(WEB, ".next", "standalone");
const DASHBOARD = join(CLI, "dashboard");
const SIZE_BUDGET_MB = 80;
const SIZE_LIMIT_MB = 120;

const skipWeb = process.argv.includes("--skip-web");

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
}

console.log("== build TS workspaces ==");
run("npm run build", ROOT);

let packed = null;
if (!skipWeb) {
  console.log("== build web (Next.js standalone) ==");
  run("npm run build -w @openagenthub/web", ROOT);
  if (!existsSync(join(STANDALONE, "web", "server.js"))) {
    throw new Error("next standalone output missing: expected web/.next/standalone/web/server.js");
  }

  console.log("== bundle dashboard into cli/dashboard ==");
  rmSync(DASHBOARD, { recursive: true, force: true });
  mkdirSync(DASHBOARD, { recursive: true });
  cpSync(join(STANDALONE, "node_modules"), join(DASHBOARD, "node_modules"), { recursive: true });
  for (const entry of ["server.js", "package.json", "src", ".next", "next.config.mjs"]) {
    const src = join(STANDALONE, "web", entry);
    if (existsSync(src)) cpSync(src, join(DASHBOARD, entry), { recursive: true });
  }
  const webStatic = join(WEB, ".next", "static");
  if (existsSync(webStatic)) cpSync(webStatic, join(DASHBOARD, ".next", "static"), { recursive: true });
  const cliPkg = JSON.parse(readFileSync(join(CLI, "package.json"), "utf8"));
  writeFileSync(join(DASHBOARD, "VERSION"), `${cliPkg.name}@${cliPkg.version}\n`);
}

console.log("== npm pack ==");
const packOut = execSync("npm pack --json", { cwd: CLI, encoding: "utf8" });
packed = JSON.parse(packOut)[0];
const sizeMb = packed.size / (1024 * 1024);
console.log(`tarball: ${packed.filename} (${sizeMb.toFixed(1)} MiB, ${packed.entryCount} entries)`);
if (sizeMb > SIZE_LIMIT_MB) {
  throw new Error(`package size ${sizeMb.toFixed(1)} MiB exceeds hard limit ${SIZE_LIMIT_MB} MiB`);
}
if (sizeMb > SIZE_BUDGET_MB) {
  console.warn(`warning: package size ${sizeMb.toFixed(1)} MiB exceeds budget ${SIZE_BUDGET_MB} MiB`);
}
console.log(`size budget: ${SIZE_BUDGET_MB} MiB soft / ${SIZE_LIMIT_MB} MiB hard — ${sizeMb <= SIZE_BUDGET_MB ? "within budget" : "over budget"}`);
