import { execFile, execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import type { RunOptions, RunResult, Sandbox, SandboxSpec } from "./types.js";

export class UnsupportedLanguageError extends Error {}

function splitCommand(command: string): string[] {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error("empty command");
  for (const t of tokens) {
    if (/[;&|<>`$()]/.test(t)) {
      throw new Error(`shell metacharacters are not allowed on the process sandbox path: '${t}'`);
    }
  }
  return tokens;
}

export class ProcessSandbox implements Sandbox {
  readonly kind = "process" as const;
  private readonly agentDir: string;
  private readonly pythonBin: string;
  private prepared = false;

  constructor(
    private readonly spec: SandboxSpec,
    private readonly trustLevel: "trusted" | "local",
  ) {
    if (trustLevel !== "trusted" && trustLevel !== "local") {
      throw new Error("ProcessSandbox requires a 'trusted' or 'local' agent; untrusted/unknown agents must use container isolation");
    }
    this.agentDir = spec.agentDir;
    this.pythonBin = process.env.PYTHON_BIN ?? "python3";
  }

  async prepare(): Promise<void> {
    if (this.prepared) return;
    const deps = this.spec.manifest.dependencies ?? {};
    const lang = this.spec.manifest.runtime.language;

    if (lang === "python" && deps.pip && deps.pip.length > 0) {
      if (!this.spec.network) {
        throw new Error("agent declares pip dependencies but network permission was not granted");
      }
      const venv = join(this.agentDir, ".venv");
      try {
        execFileSync(this.pythonBin, ["-m", "venv", venv], { stdio: "inherit" });
      } catch (e) {
        throw new Error(`failed to create virtual environment: ${(e as Error).message}`);
      }
      const pip = join(venv, "bin", "pip");
      execFileSync(pip, ["install", "--disable-pip-version-check", "--quiet", ...deps.pip], { stdio: "inherit" });
    } else if (lang === "node" && deps.npm && deps.npm.length > 0) {
      if (!this.spec.network) {
        throw new Error("agent declares npm dependencies but network permission was not granted");
      }
      execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent", ...deps.npm], {
        cwd: this.agentDir,
        stdio: "inherit",
      });
    }
    this.prepared = true;
  }

  private envFor(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.spec.env };
  }

  async run(opts: RunOptions): Promise<RunResult> {
    await this.prepare();
    const [cmd, ...args] = splitCommand(opts.command);
    const child = spawn(cmd, args, {
      cwd: this.agentDir,
      env: this.envFor(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, opts.timeoutMs)
        : undefined;
      child.stdout.on("data", (d) => {
        stdout += d.toString();
        if (opts.streamOutput) process.stdout.write(d);
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
        if (opts.streamOutput) process.stderr.write(d);
      });
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
    const [cmd, ...args] = splitCommand(opts.command);
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: this.agentDir, env: this.envFor(), stdio: "inherit" });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
  }

  async cleanup(): Promise<void> {
    // The venv stays cached for fast re-runs. Nothing to tear down.
  }
}
