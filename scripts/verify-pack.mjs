#!/usr/bin/env node
import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

console.log("== control-plane daemon lifecycle (clean install) ==");
const cpHOME = join(TMP, "cp-home");
const cpEnv = { ...process.env, AGENT_HOME: cpHOME, OPENAGENTHUB_NO_DAEMON: "" };
const runCp = (args) => execFileSync(bin("openagenthub"), args, { encoding: "utf8", env: cpEnv });
check("dashboard start spawns one daemon", () => {
  const out = runCp(["dashboard", "start"]);
  if (!/control plane started/.test(out)) throw new Error(`unexpected start output: ${out}`);
});
let cpPort = 0;
check("state.json written with ready health", () => {
  const state = JSON.parse(readFileSync(join(cpHOME, "control-plane", "state.json"), "utf8"));
  cpPort = state.port;
  if (state.health !== "ready") throw new Error(`health=${state.health}`);
});
let apiOk = true;
let apiError = "";
try {
  const health = await fetch(`http://127.0.0.1:${cpPort}/api/local/v1/health`);
  if (!health.ok) throw new Error(`health status ${health.status}`);
  const version = await (await fetch(`http://127.0.0.1:${cpPort}/api/local/v1/version`)).json();
  if (version.protocolVersion !== 1) throw new Error(`protocolVersion ${version.protocolVersion}`);
  const noToken = await fetch(`http://127.0.0.1:${cpPort}/api/local/v1/snapshot`);
  if (noToken.status !== 401) throw new Error(`snapshot without token: ${noToken.status}`);
  const token = readFileSync(join(cpHOME, "control-plane", "token"), "utf8").trim();
  const withToken = await fetch(`http://127.0.0.1:${cpPort}/api/local/v1/snapshot`, { headers: { authorization: `Bearer ${token}` } });
  if (withToken.status !== 200) throw new Error(`snapshot with token: ${withToken.status}`);
} catch (err) {
  apiOk = false;
  apiError = err.message;
}
check("local API: health + version public, snapshot needs token", () => {
  if (!apiOk) throw new Error(apiError);
});
check("second start reuses the running daemon", () => {
  const out = runCp(["dashboard", "start"]);
  if (!/already running/.test(out)) throw new Error(`expected reuse: ${out}`);
});
check("dashboard stop terminates the daemon", () => {
  const out = runCp(["dashboard", "stop"]);
  if (!/stopped/.test(out)) throw new Error(`stop output: ${out}`);
  const state = JSON.parse(readFileSync(join(cpHOME, "control-plane", "state.json"), "utf8"));
  if (state.health !== "stopped") throw new Error(`health after stop: ${state.health}`);
  let alive = true;
  try {
    process.kill(state.pid, 0);
  } catch {
    alive = false;
  }
  if (alive) throw new Error("daemon still alive after stop");
});
check("OPENAGENTHUB_NO_DAEMON=1 disables the control plane", () => {
  const env = { ...cpEnv, OPENAGENTHUB_NO_DAEMON: "1" };
  let stderr = "";
  let threw = false;
  try {
    execFileSync(bin("openagenthub"), ["dashboard", "status"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    threw = true;
    stderr = err.stderr ?? "";
  }
  if (!threw || !/disabled by OPENAGENTHUB_NO_DAEMON/.test(stderr)) {
    throw new Error(`expected disable message, got: ${stderr || "no error"}`);
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
