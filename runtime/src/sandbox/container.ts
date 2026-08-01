import { execFile, execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { RunOptions, RunResult, Sandbox, SandboxSpec } from "./types.js";

const IMAGES: Record<string, string> = {
  python: "python:3.12-slim",
  node: "node:22-bookworm-slim",
  other: "python:3.12-slim",
};

const MEMORY_LIMIT = "512m";
const CPU_LIMIT = "1";
const PIDS_LIMIT = "256";
const UID = 10001;
const GID = 10001;

export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function depsVolumeName(spec: SandboxSpec): string {
  const slug = `${spec.manifest.name}@${spec.manifest.version}`.toLowerCase().replace(/[^a-z0-9@._-]/g, "-");
  const h = createHash("sha256").update(slug).digest("hex").slice(0, 12);
  return `oah-deps-${h}`;
}

export class ContainerSandbox implements Sandbox {
  readonly kind = "container" as const;
  private prepared = false;
  private readonly volume: string;
  private readonly image: string;
  private readonly depsVolumeMounted = true;

  constructor(private readonly spec: SandboxSpec) {
    this.image = IMAGES[spec.manifest.runtime.language] ?? IMAGES.other;
    this.volume = depsVolumeName(spec);
  }

  private baseFlags(): string[] {
    const flags: string[] = [
      "--rm",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      PIDS_LIMIT,
      "--memory",
      MEMORY_LIMIT,
      "--cpus",
      CPU_LIMIT,
      "--user",
      `${UID}:${GID}`,
    ];
    if (!this.spec.network) flags.push("--network", "none");
    if (this.spec.granted.includes("filesystem")) {
      flags.push("--tmpfs", "/work:rw,size=64m");
    } else {
      flags.push("--read-only", "--tmpfs", "/tmp:rw,size=32m");
    }
    return flags;
  }

  private envFlags(): string[] {
    const flags: string[] = [];
    for (const [k, v] of Object.entries(this.spec.env)) {
      flags.push("--env", `${k}=${v}`);
    }
    return flags;
  }

  private mountFlags(): string[] {
    return [
      "--volume",
      `${this.spec.agentDir}:/app:ro`,
      "--workdir",
      "/app",
    ];
  }

  async prepare(): Promise<void> {
    if (this.prepared) return;
    if (!dockerAvailable()) throw new Error("docker is not available");

    try {
      execFileSync("docker", ["image", "inspect", this.image], { stdio: "ignore" });
    } catch {
      execFileSync("docker", ["pull", this.image], { stdio: "inherit" });
    }

    const deps = this.spec.manifest.dependencies ?? {};
    const lang = this.spec.manifest.runtime.language;
    const hasDeps = (deps.pip?.length ?? 0) > 0 || (deps.npm?.length ?? 0) > 0;

    if (hasDeps) {
      if (!this.spec.network) {
        throw new Error("agent declares dependencies but network permission was not granted");
      }
      execFileSync("docker", ["volume", "create", this.volume], { stdio: "ignore" });
      const installCmd =
        lang === "python"
          ? `pip install --no-cache-dir --target /deps ${deps.pip!.map(quote).join(" ")}`
          : `npm install --prefix /deps --no-audit --no-fund --silent ${deps.npm!.map(quote).join(" ")}`;
      execFileSync(
        "docker",
        ["run", ...this.baseFlags(), ...this.envFlags(), "--volume", `${this.volume}:/deps`, this.image, "/bin/sh", "-c", installCmd],
        { stdio: "inherit" },
      );
    }

    this.prepared = true;
  }

  private resolveCommand(cmd: string): string {
    const envLine =
      this.spec.manifest.runtime.language === "python"
        ? "export PYTHONPATH=/deps"
        : "export NODE_PATH=/deps/node_modules";
    return `set -e; ${envLine}; cd /app && ${cmd}`;
  }

  buildRunArgs(command: string): string[] {
    return [
      "run",
      "--interactive",
      ...this.baseFlags(),
      ...this.envFlags(),
      ...this.mountFlags(),
      "--volume",
      `${this.volume}:/deps`,
      this.image,
      "/bin/sh",
      "-c",
      this.resolveCommand(command),
    ];
  }

  async run(opts: RunOptions): Promise<RunResult> {
    await this.prepare();
    const args = this.buildRunArgs(opts.command);
    return new Promise((resolve) => {
      const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, opts.timeoutMs)
        : undefined;
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      if (opts.input) child.stdin.write(opts.input);
      child.stdin.end();
      child.on("error", (e) => {
        if (timer) clearTimeout(timer);
        resolve({ exitCode: 1, stdout, stderr: `${e.message}\n${stderr}`, timedOut });
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
      });
    });
  }

  async runInteractive(opts: RunOptions): Promise<number> {
    await this.prepare();
    const args = this.buildRunArgs(opts.command);
    return new Promise((resolve) => {
      const child = spawn("docker", args, { stdio: "inherit" });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
  }

  async cleanup(): Promise<void> {
    try {
      execFile("docker", ["volume", "rm", this.volume], { timeout: 10_000 }, () => {
        /* best effort */
      });
    } catch {
      /* ignore */
    }
  }
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
