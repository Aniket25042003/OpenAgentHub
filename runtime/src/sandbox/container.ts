import { execFile, execFileSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { RunOptions, RunResult, Sandbox, SandboxSpec } from "./types.js";

const IMAGE_TAGS: Record<string, string> = {
  python: "python:3.12-slim",
  node: "node:22-bookworm-slim",
  other: "python:3.12-slim",
};

const IMAGE_DIGESTS: Record<string, string> = {
  python: process.env.OPENAGENTHUB_IMAGE_DIGEST_PYTHON ?? "",
  node: process.env.OPENAGENTHUB_IMAGE_DIGEST_NODE ?? "",
  other: process.env.OPENAGENTHUB_IMAGE_DIGEST_PYTHON ?? "",
};

export const MANAGER_LABEL_VALUE = `openagenthub-runtime-${process.env.OAH_RUNTIME_VERSION ?? "0.x"}`;

const MEMORY_LIMIT = "512m";
const CPU_LIMIT = "1";
const PIDS_LIMIT = "256";
const TMPFS_WORK_SIZE = "64m";
const TMPFS_TMP_SIZE = "32m";
const UID = 10001;
const GID = 10001;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export function dockerInstallHint(): string {
  const lines = [
    "docker is not available but the container sandbox is required",
    "  - macOS: install Docker Desktop (https://www.docker.com/products/docker-desktop) and start it",
    "  - Linux: install Docker Engine (https://docs.docker.com/engine/install/) and start the daemon",
    "  - verify with: docker version",
  ];
  return lines.join("\n");
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
  private envFile: string | undefined;

  constructor(private readonly spec: SandboxSpec) {
    this.image = resolveImage(spec.manifest.runtime.language);
    this.volume = depsVolumeName(spec);
  }

  private labelFlags(): string[] {
    const flags: string[] = [];
    const labels: Record<string, string> = {
      "oah.manager": MANAGER_LABEL_VALUE,
      "oah.package": this.spec.manifest.name,
      "oah.version": this.spec.manifest.version,
      "oah.sandbox": "container",
      "oah.run_id": this.spec.runId ?? "unknown",
      "oah.interface": this.spec.interfaceName ?? "cli",
      "oah.digest": this.spec.packageDigest ?? "unknown",
    };
    for (const [k, v] of Object.entries(labels)) flags.push("--label", `${k}=${v}`);
    return flags;
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
      ...this.labelFlags(),
    ];
    if (!this.spec.network) flags.push("--network", "none");
    if (this.spec.granted.includes("filesystem")) {
      flags.push("--tmpfs", `/work:rw,size=${TMPFS_WORK_SIZE}`);
    } else {
      flags.push("--read-only", "--tmpfs", `/tmp:rw,size=${TMPFS_TMP_SIZE}`);
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
    if (!dockerAvailable()) throw new Error(dockerInstallHint());

    const tag = imageTag(this.spec.manifest.runtime.language);
    try {
      execFileSync("docker", ["image", "inspect", tag], { stdio: "ignore", timeout: 10_000 });
    } catch {
      try {
        execFileSync("docker", ["pull", this.image], { stdio: "inherit", timeout: 120_000 });
      } catch {
        await this.cleanup();
        throw new Error(`failed to pull image ${this.image}; check network access and Docker configuration`);
      }
    }

    const deps = this.spec.manifest.dependencies ?? {};
    const lang = this.spec.manifest.runtime.language;
    const hasDeps = (deps.pip?.length ?? 0) > 0 || (deps.npm?.length ?? 0) > 0;

    if (hasDeps) {
      if (!this.spec.network) {
        throw new Error("agent declares dependencies but network permission was not granted");
      }
      execFileSync("docker", ["volume", "create", this.volume], { stdio: "ignore", timeout: 10_000 });
      const installCmd =
        lang === "python"
          ? `pip install --no-cache-dir --target /deps ${deps.pip!.map(quote).join(" ")}`
          : `npm install --prefix /deps --no-audit --no-fund --silent ${deps.npm!.map(quote).join(" ")}`;
      try {
        execFileSync(
          "docker",
          ["run", ...this.baseFlags(), ...this.envFlags(), "--volume", `${this.volume}:/deps`, this.image, "/bin/sh", "-c", installCmd],
          { stdio: "inherit", timeout: 300_000 },
        );
      } catch (err) {
        await this.cleanup();
        throw new Error(`dependency installation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
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

  buildRunArgs(command: string, envFile?: string): string[] {
    const flags = envFile ? ["--env-file", envFile] : this.envFlags();
    return [
      "run",
      "--interactive",
      ...this.baseFlags(),
      ...flags,
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
    const envFile = this.writeEnvFile();
    try {
      const args = this.buildRunArgs(opts.command, envFile);
      return await new Promise((resolve) => {
        const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let truncatedOut = false;
        let truncatedErr = false;
        let timedOut = false;
        const timer = opts.timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              child.kill("SIGKILL");
            }, opts.timeoutMs)
          : undefined;
        child.stdout.on("data", (d: Buffer) => {
          if (opts.streamOutput) process.stdout.write(d);
          if (stdout.length < MAX_OUTPUT_BYTES) {
            stdout += d.toString().slice(0, MAX_OUTPUT_BYTES - stdout.length);
            if (stdout.length >= MAX_OUTPUT_BYTES) truncatedOut = true;
          } else {
            truncatedOut = true;
          }
        });
        child.stderr.on("data", (d: Buffer) => {
          if (opts.streamOutput) process.stderr.write(d);
          if (stderr.length < MAX_OUTPUT_BYTES) {
            stderr += d.toString().slice(0, MAX_OUTPUT_BYTES - stderr.length);
            if (stderr.length >= MAX_OUTPUT_BYTES) truncatedErr = true;
          } else {
            truncatedErr = true;
          }
        });
        if (opts.input) child.stdin.write(opts.input);
        child.stdin.end();
        child.on("error", (e) => {
          if (timer) clearTimeout(timer);
          resolve({ exitCode: 1, stdout, stderr: `${e.message}\n${stderr}`, timedOut });
        });
        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          if (truncatedOut) stdout += "\n[output truncated at 1 MiB]";
          if (truncatedErr) stderr += "\n[output truncated at 1 MiB]";
          resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
        });
      });
    } finally {
      this.removeEnvFile(envFile);
    }
  }

  async runInteractive(opts: RunOptions): Promise<number> {
    await this.prepare();
    const envFile = this.writeEnvFile();
    try {
      const args = this.buildRunArgs(opts.command, envFile);
      return await new Promise((resolve) => {
        const child = spawn("docker", args, { stdio: "inherit" });
        child.on("exit", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
      });
    } finally {
      this.removeEnvFile(envFile);
    }
  }

  private writeEnvFile(): string | undefined {
    const secrets = Object.entries(this.spec.env).filter(([k]) => /SECRET|TOKEN|KEY|PASSWORD/i.test(k));
    if (secrets.length === 0) return undefined;
    const dir = mkdtempSync(join(tmpdir(), "oah-env-"));
    const path = join(dir, "secrets.env");
    writeFileSync(path, secrets.map(([k, v]) => `${k}=${v}`).join("\n"), { mode: 0o600 });
    this.envFile = path;
    return path;
  }

  private removeEnvFile(path: string | undefined): void {
    if (!path) return;
    try {
      rmSync(dirname(path), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    this.envFile = undefined;
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

export function resolveImage(language: string): string {
  const tag = IMAGE_TAGS[language] ?? IMAGE_TAGS.other;
  const digest = IMAGE_DIGESTS[language] ?? IMAGE_DIGESTS.other;
  return digest ? `${tag}@${digest}` : tag;
}

export function imageTag(language: string): string {
  return IMAGE_TAGS[language] ?? IMAGE_TAGS.other;
}
