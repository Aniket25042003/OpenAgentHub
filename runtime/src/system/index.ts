import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { arch, cpus, freemem, homedir, hostname, loadavg, platform, totalmem, uptime } from "node:os";
import { join } from "node:path";
import { detectRuntime } from "@openagenthub/sdk";
import { AGENTS_DIR, REGISTRY_DEFAULT } from "../config.js";
import { loadConfig } from "../permissions.js";
import { KNOWN_AGENTS } from "./catalog.js";
import { containerMatches, isOahContainer, parseContainerLine, parsePsLine, processMatches } from "./detect.js";
import type { AgentStatus, ContainerInfo, DetectedAgent, DetectionSource, HostInfo, OahInstalledAgent, SystemSnapshot } from "./types.js";

export * from "./types.js";
export * from "./catalog.js";
export * from "./detect.js";

export interface DetectOptions {
  home?: string;
  allContainers?: boolean;
}

export function dockerVersion(): string | undefined {
  try {
    return execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function listContainers(opts: { all?: boolean } = {}): ContainerInfo[] {
  if (!dockerVersion()) return [];
  try {
    const out = execFileSync("docker", ["ps", ...(opts.all ? ["--all"] : []), "--format", "{{json .}}"], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => parseContainerLine(l))
      .filter((c): c is ContainerInfo => c !== null);
  } catch {
    return [];
  }
}

function psLines(): string[] {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", timeout: 10_000 }).split("\n");
  } catch {
    return [];
  }
}

function which(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function portListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(400, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

async function detectAgents(containers: ContainerInfo[], opts: DetectOptions): Promise<DetectedAgent[]> {
  const home = opts.home ?? homedir();
  const processes = psLines()
    .map(parsePsLine)
    .filter((p): p is { pid: number; command: string } => p !== null);
  const out: DetectedAgent[] = [];
  for (const spec of KNOWN_AGENTS) {
    const via = new Set<string>();
    const agentProcesses = processes.filter((p) => processMatches(spec, p.command));
    if (agentProcesses.length > 0) via.add("process");
    const matchedContainers = containers.filter((c) => containerMatches(spec, c));
    if (matchedContainers.length > 0) via.add("container");
    const configPaths = spec.configPaths.map((p) => join(home, p)).filter((p) => existsSync(p));
    if (configPaths.length > 0) via.add("config");
    if (spec.binaries.some((b) => which(b))) via.add("binary");
    const listeningPorts: number[] = [];
    for (const port of spec.ports) {
      if (await portListening(port)) listeningPorts.push(port);
    }
    if (listeningPorts.length > 0) via.add("port");

    const status: AgentStatus =
      agentProcesses.length > 0 || matchedContainers.some((c) => c.state === "running") || listeningPorts.length > 0
        ? "running"
        : configPaths.length > 0 || matchedContainers.length > 0
          ? "installed"
          : "unknown";

    out.push({
      id: spec.id,
      displayName: spec.displayName,
      description: spec.description,
      homepage: spec.homepage,
      status,
      detectedVia: [...via] as DetectionSource[],
      processes: agentProcesses,
      containerNames: matchedContainers.map((c) => c.name),
      configPaths,
      listeningPorts,
    });
  }
  return out;
}

function hostInfo(): HostInfo {
  const rt = detectRuntime();
  const dver = dockerVersion();
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    cpus: cpus().length,
    uptimeSec: Math.floor(uptime()),
    loadavg: loadavg(),
    memTotalBytes: totalmem(),
    memFreeBytes: freemem(),
    node: rt.node ?? "unknown",
    python: rt.python,
    docker: { available: Boolean(dver), version: dver, error: dver ? undefined : "docker not available" },
  };
}

function installedAgents(): OahInstalledAgent[] {
  const config = loadConfig();
  return Object.entries(config.installed ?? {}).map(([spec, a]) => ({
    spec,
    version: a.version,
    author: a.author,
    trust: a.trust,
    installedAt: a.installedAt,
    source: a.source,
    path: join(AGENTS_DIR, a.namespace, a.name, a.version),
  }));
}

export async function systemSnapshot(opts: DetectOptions = {}): Promise<SystemSnapshot> {
  const containers = listContainers({ all: opts.allContainers });
  const agents = await detectAgents(containers, opts);
  const annotated = containers.map((c) => {
    const managed = isOahContainer(c);
    const hit = agents.find((a) => a.containerNames.includes(c.name));
    return {
      ...c,
      matchedAgentId: hit?.id,
      managedBy: managed ? ("openagenthub" as const) : hit ? ("third-party" as const) : undefined,
    };
  });
  const config = loadConfig();
  return {
    generatedAt: new Date().toISOString(),
    host: hostInfo(),
    openagenthub: {
      version: "0.1.0",
      agentsDir: AGENTS_DIR,
      registryUrl: config.registryUrl ?? REGISTRY_DEFAULT,
      installed: installedAgents(),
    },
    agents,
    containers: annotated,
  };
}
