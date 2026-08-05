#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_DIR = join(import.meta.dirname, "..", "cli");
const PORT = 31877;
const TMP = mkdtempSync(join(tmpdir(), "oah-pack-"));
const TARBALL = join(CLI_DIR, process.argv[2] ?? "openagenthub-cli-0.1.0.tgz");

function check(label, fn) {
  try {
    fn();
    console.log(`  ok: ${label}`);
  } catch (err) {
    console.error(`  FAIL: ${label}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("== clean-prefix install (no workspace symlinks) ==");
const prefix = join(TMP, "prefix with spaces");
execSync(`npm install --prefix "${prefix}" "${TARBALL}" --no-audit --no-fund`, { stdio: "pipe" });
const bin = (name) => join(prefix, "node_modules", ".bin", name);
const runBin = (name, args) => execSync(`"${bin(name)}" ${args}`, { encoding: "utf8" });

check("openagenthub bin exists + runs --version", () => {
  const out = runBin("openagenthub", "--version");
  if (!/@openagenthub\/cli/.test(out)) throw new Error(`unexpected version output: ${out}`);
});
check("agent alias still works", () => {
  const out = runBin("agent", "--version");
  if (!/@openagenthub\/cli/.test(out)) throw new Error(`unexpected alias output: ${out}`);
});
check("help renders usage with openagenthub", () => {
  const out = runBin("openagenthub", "--help");
  if (!/USAGE\s+\$ openagenthub/.test(out)) throw new Error("usage line missing");
});

const cliPkgDir = join(prefix, "node_modules", "@openagenthub", "cli");
check("sdk/runtime are bundled (no bare @openagenthub imports)", () => {
  const runJs = readFileSync(join(cliPkgDir, "dist", "commands", "run.js"), "utf8");
  if (/from\s+"@openagenthub\/(runtime|sdk)"/.test(runJs)) throw new Error("unbundled workspace import");
});
check("dashboard bundled with VERSION marker", () => {
  if (!existsSync(join(cliPkgDir, "dashboard", "server.js"))) throw new Error("server.js missing");
  const version = readFileSync(join(cliPkgDir, "dashboard", "VERSION"), "utf8");
  if (!/^@openagenthub\/cli@/.test(version)) throw new Error(`bad VERSION: ${version}`);
});
check("package contains only intended files", () => {
  const tarballEntries = execSync(`tar -tzf ${TARBALL}`, { encoding: "utf8" });
  for (const bad of ["src/", "test/", "node_modules/", "tsconfig", "package-lock", ".env"]) {
    if (tarballEntries.split("\n").some((e) => e.includes(`package/${bad}`))) {
      throw new Error(`unexpected tarball member: ${bad}`);
    }
  }
});

console.log("== dashboard starts without the monorepo ==");
const server = spawn("node", [join(cliPkgDir, "dashboard", "server.js")], {
  env: { ...process.env, PORT: String(PORT), OPENAGENTHUB_REGISTRY_URL: "http://localhost:8000", HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "ignore", "pipe"],
});
const serverOutput = [];
server.stderr.on("data", (d) => serverOutput.push(d.toString()));
let healthOk = false;
try {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok && (await res.json()).status === "ok") {
        healthOk = true;
        break;
      }
    } catch {
      /* not up yet */
    }
  }
} finally {
  server.kill("SIGTERM");
}
check("dashboard /health responds", () => {
  if (!healthOk) {
    throw new Error(`dashboard never became healthy: ${serverOutput.join("").slice(0, 500)}`);
  }
});

console.log("== user data untouched by uninstall ==");
const home = join(TMP, "userhome");
execSync(`mkdir -p "${home}"`, { stdio: "pipe" });
execSync(`npm uninstall --prefix "${prefix}" @openagenthub/cli --no-audit --no-fund`, { stdio: "pipe" });
check("AGENT_HOME data survives uninstall", () => {
  if (!existsSync(home)) throw new Error("user data dir missing");
});

rmSync(TMP, { recursive: true, force: true });
if (process.exitCode) {
  console.error("PACK VERIFICATION FAILED");
  process.exit(1);
}
console.log("PACK VERIFICATION PASSED");
