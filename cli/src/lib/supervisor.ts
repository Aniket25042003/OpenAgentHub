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
import { join } from "node:path";
import { CONTROL_BOUND_HOST, CONTROL_DIR } from "@openagenthub/runtime";
import { BIN_PATH, CONTROL_STOP_TIMEOUT_MS, LOG_MAX_BYTES, LOG_MAX_FILES, isProcessAlive, selectPort } from "./control-plane.js";

export const RUNS_DIR = join(CONTROL_DIR, "runs");
export const RUN_LOG_MAX_BYTES = LOG_MAX_BYTES;
export const RUN_LOG_MAX_FILES = LOG_MAX_FILES;
export const RUN_START_TIMEOUT_MS = 45_000;
export const STOP_ESCALATION_MS = 10_000;
export const HTTP_HEALTH_TIMEOUT_MS = 2_000;
export const DOCKER_CALL_TIMEOUT_MS = 5_000;

function dockerRun(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: DOCKER_CALL_TIMEOUT_MS,
    windowsHide: true,
  });
}

export type RunState = "starting" | "running" | "stopping" | "exited" | "failed" | "orphaned";
export type RunHealth = "unknown" | "ok" | "unhealthy";
export type ExitReason = "exit" | "signal" | "timeout" | "oom" | "manual-stop" | "crashed" | "container-gone" | "supervisor-gone";
export type RestartPolicy = "none" | "always";

export interface RunRecord {
  runId: string;
  agentKey: string;
  version: string;
  interfaceName: "cli" | "mcp" | "http";
  sandbox: "container" | "process" | "none";
  managed: boolean;
  state: RunState;
  pid?: number;
  containerId?: string;
  port?: number;
  health: RunHealth;
  timeoutMs?: number;
  restartPolicy: RestartPolicy;
  createdAt: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  exitReason?: ExitReason;
  digest?: string;
}

const VALID_STATES: RunState[] = ["starting", "running", "stopping", "exited", "failed", "orphaned"];

export function newRunId(): string {
  return `r-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function runRecordPath(runId: string): string {
  return join(RUNS_DIR, `${runId}.json`);
}

export function runLogPath(runId: string): string {
  return join(RUNS_DIR, `${runId}.log`);
}

export function readRun(runId: string): RunRecord | null {
  try {
    const raw = readFileSync(runRecordPath(runId), "utf8");
    const parsed = JSON.parse(raw) as RunRecord;
    if (typeof parsed.runId !== "string" || !VALID_STATES.includes(parsed.state)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRun(record: RunRecord): void {
  if (!VALID_STATES.includes(record.state)) throw new Error(`invalid run state: ${record.state}`);
  mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${runRecordPath(record.runId)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  renameSync(tmp, runRecordPath(record.runId));
}

export function removeRun(runId: string): void {
  rmSync(runRecordPath(runId), { force: true });
  for (const f of runLogFilenames(runId)) rmSync(f, { force: true });
  rmSync(runLogPath(runId), { force: true });
}

export function listRuns(): RunRecord[] {
  try {
    return readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8")) as RunRecord)
      .filter((r) => typeof r.runId === "string" && VALID_STATES.includes(r.state))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  } catch {
    return [];
  }
}

export const ACTIVE_STATES: RunState[] = ["starting", "running", "stopping"];

export function runIsActive(record: RunRecord): boolean {
  return ACTIVE_STATES.includes(record.state);
}

export function rotateRunLog(runId: string): void {
  const logPath = runLogPath(runId);
  try {
    const size = statSync(logPath).size;
    if (size < RUN_LOG_MAX_BYTES) return;
  } catch {
    return;
  }
  rmSync(`${logPath}.${RUN_LOG_MAX_FILES - 1}`, { force: true });
  for (let i = RUN_LOG_MAX_FILES - 2; i >= 0; i--) {
    const from = i === 0 ? logPath : `${logPath}.${i}`;
    if (existsSync(from)) renameSync(from, `${logPath}.${i + 1}`);
  }
}

export function runLogFilenames(runId: string): string[] {
  try {
    return readdirSync(RUNS_DIR)
      .filter((f) => f.startsWith(`${runId}.log`))
      .sort((a, b) => (a < b ? 1 : -1))
      .map((f) => join(RUNS_DIR, f));
  } catch {
    return [];
  }
}

export function readRunLogTail(runId: string, lines: number = 100): string {
  const files = runLogFilenames(runId);
  let text = "";
  for (const file of files) {
    try {
      text += readFileSync(file, "utf8");
    } catch {
      /* skip */
    }
  }
  const trimmed = text.replace(/\n$/, "");
  if (!trimmed) return "";
  return trimmed.split("\n").slice(-lines).join("\n");
}

export interface ManagedRunOptions {
  runId: string;
  agentKey: string;
  version: string;
  interfaceName: "cli" | "mcp" | "http";
  sandbox: "container" | "process" | "none";
  port?: number;
  timeoutMs?: number;
  restartPolicy?: RestartPolicy;
  digest?: string;
  input?: string;
}

export interface ManagedRunResult {
  record: RunRecord;
  workerPid: number;
}

export function startManagedRun(opts: ManagedRunOptions): ManagedRunResult {
  const now = new Date().toISOString();
  mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });
  const logFd = openSync(runLogPath(opts.runId), "a");
  const record: RunRecord = {
    runId: opts.runId,
    agentKey: opts.agentKey,
    version: opts.version,
    interfaceName: opts.interfaceName,
    sandbox: opts.sandbox,
    managed: true,
    state: "starting",
    health: "unknown",
    port: opts.port,
    timeoutMs: opts.timeoutMs,
    restartPolicy: opts.restartPolicy ?? "none",
    createdAt: now,
    startedAt: now,
    digest: opts.digest,
  };
  writeRun(record);

  const child = spawn(process.execPath, [BIN_PATH, "supervisor-run", opts.runId], {
    detached: true,
    stdio: ["pipe", logFd, logFd],
  });
  child.unref();
  if (opts.input !== undefined && opts.input !== "") {
    child.stdin?.write(opts.input);
  }
  child.stdin?.end();

  record.pid = child.pid ?? undefined;
  writeRun(record);
  return { record, workerPid: child.pid ?? 0 };
}

export async function waitForRunStart(runId: string, timeoutMs: number = RUN_START_TIMEOUT_MS): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = readRun(runId);
    if (!record) throw new Error(`run ${runId} disappeared while starting`);
    if (record.state === "running" || record.state === "exited" || record.state === "failed" || record.state === "orphaned") {
      return record;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const record = readRun(runId);
  if (!record) throw new Error(`run ${runId} disappeared while starting`);
  return record;
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function dockerContainerByRunId(runId: string): { id: string; running: boolean; oomKilled: boolean } | null {
  try {
    const id = dockerRun(["ps", "-a", "--filter", `label=oah.run_id=${runId}`, "--format", "{{.ID}}"])
      .trim()
      .split("\n")[0];
    if (!id) return null;
    let running = false;
    try {
      running = dockerRun(["inspect", "-f", "{{.State.Running}}", id]).trim() === "true";
    } catch {
      /* container gone mid-probe */
    }
    let oomKilled = false;
    try {
      oomKilled = dockerRun(["inspect", "-f", "{{.State.OOMKilled}}", id]).trim() === "true";
    } catch {
      /* container gone mid-probe */
    }
    return { id, running, oomKilled };
  } catch {
    return null;
  }
}

export interface RunProbe {
  isAlive: (pid: number) => boolean;
  groupAlive: (pid: number) => boolean;
  container: (runId: string) => { id: string; running: boolean; oomKilled: boolean } | null;
}

const defaultProbe: RunProbe = {
  isAlive: isProcessAlive,
  groupAlive: processGroupAlive,
  container: dockerContainerByRunId,
};

export function reconcileRun(record: RunRecord, probe: RunProbe = defaultProbe): RunRecord {
  if (!runIsActive(record)) return record;
  const updated = { ...record };
  if (record.sandbox === "container") {
    const c = probe.container(record.runId);
    if (!c) {
      updated.state = "exited";
      updated.exitReason = "container-gone";
      updated.endedAt = new Date().toISOString();
    } else if (!c.running) {
      updated.state = "exited";
      updated.exitReason = c.oomKilled ? "oom" : "signal";
      updated.endedAt = new Date().toISOString();
    } else {
      updated.containerId = c.id;
    }
    return updated;
  }
  const pid = record.pid;
  if (pid === undefined) {
    updated.state = "exited";
    updated.exitReason = "crashed";
    updated.endedAt = new Date().toISOString();
    return updated;
  }
  const workerAlive = probe.isAlive(pid);
  if (!workerAlive && !probe.groupAlive(pid)) {
    updated.state = "exited";
    updated.exitReason = "crashed";
    updated.endedAt = new Date().toISOString();
  } else if (!workerAlive) {
    updated.state = "orphaned";
    updated.exitReason = "supervisor-gone";
    updated.endedAt = new Date().toISOString();
  }
  return updated;
}

export function reconcileRuns(): { updated: number; orphanedContainers: string[] } {
  const orphans = orphanContainers();
  let updated = 0;
  for (const record of listRuns()) {
    const next = reconcileRun(record);
    if (next.state !== record.state) {
      writeRun(next);
      updated++;
    }
  }
  return { updated, orphanedContainers: orphans };
}

export function orphanContainers(): string[] {
  try {
    const known = new Set(listRuns().map((r) => r.runId));
    const all = dockerRun(["ps", "-a", "--filter", "label=oah.manager", "--format", "{{.ID}}\t{{.Label \"oah.run_id\"}}\t{{.Label \"oah.package\"}}"])
      .trim()
      .split("\n")
      .filter(Boolean);
    const orphans: string[] = [];
    for (const line of all) {
      const [id, runId, pkg] = line.split("\t");
      if (runId === "unknown" || !known.has(runId)) orphans.push(`${id.slice(0, 12)} (${pkg}, run ${runId})`);
    }
    return orphans;
  } catch {
    return [];
  }
}

export async function stopRun(runId: string): Promise<{ stopped: boolean; record: RunRecord }> {
  let record = readRun(runId);
  if (!record) throw new Error(`run ${runId} not found`);
  if (!runIsActive(record)) throw new Error(`run ${runId} is not running (state: ${record.state})`);

  record = { ...record, state: "stopping" };
  writeRun(record);

  if (record.sandbox === "container") {
    let containerId = record.containerId;
    if (!containerId) containerId = dockerContainerByRunId(runId)?.id;
    if (!containerId) {
      writeRun({ ...record, state: "running" });
      throw new Error(`run ${runId} has no matching container (label oah.run_id=${runId})`);
    }
    try {
      dockerRun(["stop", "-t", String(STOP_ESCALATION_MS / 1000), containerId]);
    } catch {
      /* already stopped */
    }
    return await settleRun(runId, record, () => !dockerContainerByRunId(runId));
  }

  if (record.pid) {
    await killProcessGroup(record.pid);
  }
  return await settleRun(runId, record, () => !record.pid || (!isProcessAlive(record.pid) && !processGroupAlive(record.pid)));
}

async function settleRun(
  runId: string,
  fallback: RunRecord,
  isDead: () => boolean,
): Promise<{ stopped: boolean; record: RunRecord }> {
  const deadline = Date.now() + (fallback.sandbox === "container" ? STOP_ESCALATION_MS + 5_000 : 5_000);
  while (Date.now() < deadline) {
    const record = readRun(runId);
    if (record && record.state !== "stopping") return { stopped: true, record };
    if (record && record.state === "stopping" && isDead()) {
      const final: RunRecord = { ...record, state: "exited", exitCode: 0, exitReason: "manual-stop", endedAt: new Date().toISOString() };
      writeRun(final);
      return { stopped: true, record: final };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const record = readRun(runId) ?? fallback;
  return { stopped: !runIsActive(record), record };
}

async function killProcessGroup(pid: number): Promise<void> {
  if (processGroupAlive(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* group vanished */
    }
  }
  const deadline = Date.now() + CONTROL_STOP_TIMEOUT_MS;
  while (Date.now() < deadline && processGroupAlive(pid)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (processGroupAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* group vanished */
    }
  }
}

export interface RestartRunOptions {
  runId: string;
  agentKey: string;
  version: string;
  interfaceName: "cli" | "mcp" | "http";
  sandbox: "container" | "process" | "none";
  port?: number;
  timeoutMs?: number;
  digest?: string;
  input?: string;
}

export async function restartRun(opts: RestartRunOptions): Promise<ManagedRunResult> {
  const existing = readRun(opts.runId);
  if (!existing) throw new Error(`run ${opts.runId} not found`);
  if (runIsActive(existing)) {
    const { record } = await stopRun(opts.runId);
    if (runIsActive(record)) throw new Error(`run ${opts.runId} did not stop in time`);
  }
  rmSync(runLogPath(opts.runId), { force: true });
  for (const f of runLogFilenames(opts.runId)) rmSync(f, { force: true });
  return startManagedRun({
    runId: opts.runId,
    agentKey: opts.agentKey,
    version: opts.version,
    interfaceName: opts.interfaceName,
    sandbox: opts.sandbox,
    port: opts.port,
    timeoutMs: opts.timeoutMs,
    digest: opts.digest,
    input: opts.input,
    restartPolicy: existing.restartPolicy,
  });
}

export function containerStats(containerId: string): Record<string, string> | null {
  try {
    const out = dockerRun(["stats", "--no-stream", "--format", "{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}", containerId]).trim();
    const [memUsage, memPerc, cpuPerc] = out.split("\t");
    return { memUsage, memPerc, cpuPerc };
  } catch {
    return null;
  }
}

export async function probeHttpHealth(port: number): Promise<RunHealth> {
  try {
    const res = await fetch(`http://${CONTROL_BOUND_HOST}:${port}/`, { signal: AbortSignal.timeout(HTTP_HEALTH_TIMEOUT_MS) });
    return res.ok ? "ok" : "unhealthy";
  } catch {
    return "unhealthy";
  }
}

export async function allocatePort(): Promise<number> {
  return selectPort(31_977);
}
