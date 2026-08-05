import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AGENT_HOME,
  CONTROL_BOUND_HOST,
  CONTROL_DIR,
  CONTROL_LOCK_DIR,
  CONTROL_LOG_PATH,
  CONTROL_PREFERRED_PORT,
  CONTROL_PROTOCOL_VERSION,
  CONTROL_STATE_PATH,
  CONTROL_TOKEN_PATH,
} from "@openagenthub/runtime";

export const CONTROL_HEALTH_TIMEOUT_MS = 45_000;
export const CONTROL_STOP_TIMEOUT_MS = 10_000;
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_MAX_FILES = 3;
export const PORT_PROBE_ATTEMPTS = 100;

export { CONTROL_BOUND_HOST, CONTROL_PROTOCOL_VERSION, CONTROL_PREFERRED_PORT } from "@openagenthub/runtime";

export type DaemonHealth = "starting" | "ready" | "stopped";

export interface DaemonState {
  pid: number;
  startIdentity: string;
  port: number;
  productVersion: string;
  protocolVersion: number;
  startedAt: string;
  health: DaemonHealth;
}

export class ControlPlaneDisabledError extends Error {}

const here = fileURLToPath(new URL(".", import.meta.url));
const CLI_ROOT = findCliRoot(here);
const BIN_PATH = join(CLI_ROOT, "bin", "run.js");
const DASHBOARD_SERVER_PATH = join(CLI_ROOT, "dashboard", "server.js");
const PACKAGE_JSON_PATH = join(CLI_ROOT, "package.json");

function findCliRoot(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 6; depth++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "@openagenthub/cli") return dir;
    } catch {
      /* keep walking up */
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the @openagenthub/cli package root");
}
const LAUNCHD_LABEL = "ai.openagenthub.control-plane";
const LAUNCHD_PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
const SYSTEMD_UNIT_PATH = join(homedir(), ".config", "systemd", "user", "openagenthub-control-plane.service");

export function daemonEnabled(): boolean {
  return process.env.OPENAGENTHUB_NO_DAEMON !== "1";
}

export function productVersion(): string {
  try {
    return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).version as string;
  } catch {
    return "unknown";
  }
}

export function readState(): DaemonState | null {
  try {
    const raw = readFileSync(CONTROL_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as DaemonState;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeState(state: DaemonState): void {
  mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONTROL_STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, CONTROL_STATE_PATH);
}

export function clearState(): void {
  rmSync(CONTROL_STATE_PATH, { force: true });
}

export function readToken(): string {
  try {
    const token = readFileSync(CONTROL_TOKEN_PATH, "utf8").trim();
    if (token.length >= 16) return token;
  } catch {
    /* regenerate */
  }
  mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  writeFileSync(CONTROL_TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function processStartStamp(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const stamp = out.trim();
    return stamp === "" ? null : stamp;
  } catch {
    return null;
  }
}

export function identityMatches(state: DaemonState): boolean {
  if (!isProcessAlive(state.pid)) return false;
  if (process.platform === "win32") return true;
  const stamp = processStartStamp(state.pid);
  return stamp !== null && stamp === state.startIdentity;
}

export function daemonNeedsRestart(state: DaemonState): boolean {
  return state.protocolVersion < CONTROL_PROTOCOL_VERSION || state.productVersion !== productVersion();
}

export function selectPort(preferred: number = CONTROL_PREFERRED_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (candidate: number, triesLeft: number): void => {
      const probe = createServer();
      probe.once("error", () => {
        if (triesLeft <= 0) reject(new Error(`no free port found near ${preferred}`));
        else attempt(candidate + 1, triesLeft - 1);
      });
      probe.listen(candidate, CONTROL_BOUND_HOST, () => {
        probe.close(() => resolve(candidate));
      });
    };
    attempt(preferred, PORT_PROBE_ATTEMPTS);
  });
}

export function lockOwnerPid(): number | null {
  try {
    const owner = Number(readFileSync(join(CONTROL_LOCK_DIR, "owner"), "utf8").trim());
    return Number.isInteger(owner) && owner > 0 ? owner : null;
  } catch {
    return null;
  }
}

export function acquireLock(): boolean {
  mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(CONTROL_LOCK_DIR, { mode: 0o700 });
      writeFileSync(join(CONTROL_LOCK_DIR, "owner"), String(process.pid), { mode: 0o600 });
      return true;
    } catch {
      const owner = lockOwnerPid();
      if (owner !== null && isProcessAlive(owner)) return false;
      rmSync(CONTROL_LOCK_DIR, { recursive: true, force: true });
    }
  }
  return false;
}

export function releaseLock(): void {
  try {
    const owner = lockOwnerPid();
    if (owner === process.pid || (owner !== null && !isProcessAlive(owner))) {
      rmSync(CONTROL_LOCK_DIR, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}

export function rotateLogs(): void {
  try {
    const size = statSync(CONTROL_LOG_PATH).size;
    if (size < LOG_MAX_BYTES) return;
  } catch {
    return;
  }
  rmSync(`${CONTROL_LOG_PATH}.${LOG_MAX_FILES - 1}`, { force: true });
  for (let i = LOG_MAX_FILES - 2; i >= 0; i--) {
    const from = i === 0 ? CONTROL_LOG_PATH : `${CONTROL_LOG_PATH}.${i}`;
    if (existsSync(from)) renameSync(from, `${CONTROL_LOG_PATH}.${i + 1}`);
  }
}

export function logFilenames(): string[] {
  try {
    const entries = readdirSync(CONTROL_DIR)
      .filter((f) => f.startsWith("daemon.log"))
      .sort((a, b) => (a < b ? 1 : -1));
    return entries.map((f) => join(CONTROL_DIR, f));
  } catch {
    return [];
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${CONTROL_BOUND_HOST}:${port}/api/local/v1/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export async function fetchControl<T = unknown>(port: number, path: string, opts: { method?: string; token?: string } = {}): Promise<T | null> {
  try {
    const res = await fetch(`http://${CONTROL_BOUND_HOST}:${port}${path}`, {
      method: opts.method ?? "GET",
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function spawnDaemon(port: number): void {
  const logFd = openSync(CONTROL_LOG_PATH, "a");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: CONTROL_BOUND_HOST,
    OPENAGENTHUB_DAEMON_LOCKED: "1",
    OPENAGENTHUB_LOCAL_TOKEN: readToken(),
    OPENAGENTHUB_PRODUCT_VERSION: productVersion(),
  };
  const child = spawn(process.execPath, [BIN_PATH, "daemon"], {
    detached: true,
    env,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
}

export interface EnsureResult {
  state: DaemonState;
  started: boolean;
}

export async function ensureDaemon(): Promise<EnsureResult> {
  if (!daemonEnabled()) throw new ControlPlaneDisabledError("control plane is disabled by OPENAGENTHUB_NO_DAEMON=1");

  const existing = readState();
  if (existing && identityMatches(existing)) {
    if (daemonNeedsRestart(existing)) {
      await stopDaemon();
      clearState();
    } else if (await waitForHealth(existing.port, 2000)) {
      return { state: existing, started: false };
    } else if (!isProcessAlive(existing.pid)) {
      clearState();
    }
  }

  if (!acquireLock()) {
    const deadline = Date.now() + CONTROL_HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const rival = readState();
      if (rival && (await waitForHealth(rival.port, 2000))) return { state: rival, started: false };
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("another control plane start is in progress but never became healthy");
  }

  try {
    const again = readState();
    if (again && identityMatches(again) && !daemonNeedsRestart(again) && (await waitForHealth(again.port, 2000))) {
      return { state: again, started: false };
    }
    if (again && identityMatches(again)) await stopDaemon();
    const port = await selectPort(CONTROL_PREFERRED_PORT);
    rotateLogs();
    spawnDaemon(port);
    if (!(await waitForHealth(port, CONTROL_HEALTH_TIMEOUT_MS))) {
      throw new Error(`control plane failed to become healthy on port ${port}; see ${CONTROL_LOG_PATH}`);
    }
    const state = readState();
    if (!state) throw new Error("control plane started but state is missing");
    return { state, started: true };
  } finally {
    releaseLock();
  }
}

export async function stopDaemon(): Promise<boolean> {
  const state = readState();
  if (!state) return false;
  if (!identityMatches(state)) {
    clearState();
    return false;
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    return false;
  }
  const deadline = Date.now() + CONTROL_STOP_TIMEOUT_MS;
  while (Date.now() < deadline && isProcessAlive(state.pid)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isProcessAlive(state.pid);
}

export async function restartDaemon(): Promise<EnsureResult> {
  await stopDaemon();
  return ensureDaemon();
}

export function readLogTail(lines: number = 100): string {
  const files = logFilenames();
  if (files.length === 0) return "";
  const chunks: string[] = [];
  let remaining = lines;
  for (const file of files) {
    if (remaining <= 0) break;
    try {
      const text = readFileSync(file, "utf8");
      const tail = text.split("\n").slice(-remaining);
      chunks.unshift(tail.join("\n"));
      remaining -= tail.length;
    } catch {
      /* skip */
    }
  }
  return chunks.join("\n").replace(/^\n+/, "");
}

export async function openUrl(url: string): Promise<void> {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(opener, args, { detached: true, stdio: "ignore" }).unref();
}

export async function runDaemon(): Promise<void> {
  mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 });
  if (process.env.OPENAGENTHUB_DAEMON_LOCKED === "1") {
    mkdirSync(CONTROL_LOCK_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(join(CONTROL_LOCK_DIR, "owner"), String(process.pid), { mode: 0o600 });
  } else if (!acquireLock()) {
    clearState();
    process.exit(0);
  }
  const port = Number(process.env.PORT);
  const startedAt = new Date().toISOString();
  const state: DaemonState = {
    pid: process.pid,
    startIdentity: processStartStamp(process.pid) ?? String(process.pid),
    port,
    productVersion: process.env.OPENAGENTHUB_PRODUCT_VERSION ?? productVersion(),
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    startedAt,
    health: "starting",
  };
  writeState(state);

  let ready = false;
  const shutdown = (): void => {
    writeState({ ...state, health: "stopped" });
    releaseLock();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    if (!existsSync(DASHBOARD_SERVER_PATH)) {
      throw new Error(`dashboard build missing at ${DASHBOARD_SERVER_PATH}; run npm run build -w @openagenthub/web`);
    }
    await import(pathToFileURL(DASHBOARD_SERVER_PATH).href);
    ready = await waitForHealth(port, 15_000);
    writeState({ ...state, health: ready ? "ready" : "starting" });
  } catch (err) {
    console.error(err);
    writeState({ ...state, health: "stopped" });
    releaseLock();
    process.exit(1);
  }
}

export const CONTROL_PLANS = {
  bindHost: CONTROL_BOUND_HOST,
  preferredPort: CONTROL_PREFERRED_PORT,
  protocolVersion: CONTROL_PROTOCOL_VERSION,
  launchdLabel: LAUNCHD_LABEL,
  launchdPlistPath: LAUNCHD_PLIST_PATH,
  systemdUnitPath: SYSTEMD_UNIT_PATH,
};

export async function autostartEnable(): Promise<void> {
  if (process.platform === "darwin") {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${BIN_PATH}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_HOME</key>
    <string>${AGENT_HOME}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${CONTROL_LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${CONTROL_LOG_PATH}</string>
</dict>
</plist>
`;
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true, mode: 0o700 });
    writeFileSync(LAUNCHD_PLIST_PATH, plist, { mode: 0o600 });
    execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? process.pid}`, LAUNCHD_PLIST_PATH]);
    return;
  }
  if (process.platform === "linux") {
    const unit = `[Unit]
Description=OpenAgentHub control plane
After=network.target

[Service]
ExecStart=${process.execPath} ${BIN_PATH} daemon
Environment=AGENT_HOME=${AGENT_HOME}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
    mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true, mode: 0o700 });
    writeFileSync(SYSTEMD_UNIT_PATH, unit, { mode: 0o600 });
    execFileSync("systemctl", ["--user", "daemon-reload"]);
    execFileSync("systemctl", ["--user", "enable", "--now", "openagenthub-control-plane.service"]);
    return;
  }
  throw new ControlPlaneDisabledError("autostart is not implemented on this platform; start the daemon manually");
}

export async function autostartDisable(): Promise<void> {
  if (process.platform === "darwin") {
    try {
      execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? process.pid}`, LAUNCHD_PLIST_PATH]);
    } catch {
      /* not loaded */
    }
    rmSync(LAUNCHD_PLIST_PATH, { force: true });
    return;
  }
  if (process.platform === "linux") {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", "openagenthub-control-plane.service"]);
    } catch {
      /* not loaded */
    }
    rmSync(SYSTEMD_UNIT_PATH, { force: true });
    return;
  }
  throw new ControlPlaneDisabledError("autostart is not implemented on this platform; remove the startup entry manually");
}

export async function autostartStatus(): Promise<{ enabled: boolean; path: string }> {
  if (process.platform === "darwin") {
    return { enabled: existsSync(LAUNCHD_PLIST_PATH), path: LAUNCHD_PLIST_PATH };
  }
  if (process.platform === "linux") {
    return { enabled: existsSync(SYSTEMD_UNIT_PATH), path: SYSTEMD_UNIT_PATH };
  }
  return { enabled: false, path: "" };
}

export function controlInfo(): { dir: string; statePath: string; tokenPath: string; logPath: string } {
  return { dir: CONTROL_DIR, statePath: CONTROL_STATE_PATH, tokenPath: CONTROL_TOKEN_PATH, logPath: CONTROL_LOG_PATH };
}
