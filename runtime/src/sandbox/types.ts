import type { Manifest, Permission } from "@openagenthub/sdk";

export interface RunOptions {
  command: string;
  input?: string;
  timeoutMs?: number;
  /** Forward the child's stdout/stderr to this process's stdout/stderr as it arrives. */
  streamOutput?: boolean;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface Sandbox {
  readonly kind: "container" | "process";
  /** Install declared dependencies (may require network). */
  prepare(): Promise<void>;
  /** Run a command inside the sandbox with full stdio capture. */
  run(opts: RunOptions): Promise<RunResult>;
  /** Run a command with stdio wired to the parent process (interactive / MCP servers). */
  runInteractive(opts: RunOptions): Promise<number>;
  cleanup(): Promise<void>;
}

export interface SandboxSpec {
  agentDir: string;
  manifest: Manifest;
  granted: Permission[];
  env: Record<string, string>;
  network: boolean;
  user: string;
  host: string;
  runId?: string;
  interfaceName?: string;
  packageDigest?: string;
}
