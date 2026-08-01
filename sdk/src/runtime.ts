import { spawnSync } from "node:child_process";
import type { Manifest } from "./manifest.js";

export interface DetectedRuntime {
  python?: string;
  node?: string;
  docker: boolean;
  dockerVersion?: string;
  ollama: boolean;
  uv: boolean;
  git: boolean;
}

export function detectRuntime(): DetectedRuntime {
  const run = (cmd: string, args: string[]) => {
    const res = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000, shell: false });
    if (res.error) return undefined;
    return (res.stdout ?? "").trim().split("\n")[0] || undefined;
  };
  return {
    python: run("python3", ["--version"]),
    node: run("node", ["--version"]),
    docker: (run("docker", ["--version"]) ?? "") !== "",
    dockerVersion: run("docker", ["--version"]),
    ollama: (run("ollama", ["--version"]) ?? "") !== "",
    uv: (run("uv", ["--version"]) ?? "") !== "",
    git: (run("git", ["--version"]) ?? "") !== "",
  };
}

export interface RequirementCheck {
  satisfied: boolean;
  missing: string[];
  messages: string[];
}

function compareNumeric(a: number, b: number): number {
  return a === b ? 0 : a > b ? 1 : -1;
}

export function compareVersions(a: string, b: string): number {
  const pa = (a ?? "").replace(/^[vV]/, "").split(/[-+]/)[0].split(".");
  const pb = (b ?? "").replace(/^[vV]/, "").split(/[-+]/)[0].split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i] ?? "0", 10);
    const y = parseInt(pb[i] ?? "0", 10);
    const c = compareNumeric(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

export function versionSatisfies(version: string | undefined, specifier: string | undefined): boolean {
  if (!version || !specifier) return true;
  const clean = version.replace(/^[vV]/, "").replace(/^python\s*/, "");
  const specs = specifier.split(",").map((s) => s.trim()).filter(Boolean);
  return specs.every((spec) => {
    const m = spec.match(/^(>=|<=|>|<|==|!=|~=)?\s*([0-9][0-9.]*)/);
    if (!m) return true;
    const op = m[1] || "==";
    const want = m[2];
    const c = compareVersions(clean, want);
    switch (op) {
      case ">=": return c >= 0;
      case "<=": return c <= 0;
      case ">": return c > 0;
      case "<": return c < 0;
      case "~=": return c >= 0 && clean.split(".")[0] === want.split(".")[0];
      case "!=": return c !== 0;
      default: return c === 0;
    }
  });
}

export function checkAgentRequirements(manifest: Manifest, detected: DetectedRuntime): RequirementCheck {
  const missing: string[] = [];
  const messages: string[] = [];

  const lang = manifest.runtime.language;
  if (lang === "python") {
    if (!detected.python) {
      missing.push("python3 (>=3.11 recommended)");
      messages.push("Python 3 not found.");
    } else {
      const ok = versionSatisfies(detected.python.replace("Python ", ""), manifest.runtime.python);
      messages.push(`Python ${detected.python.replace("Python ", "")} detected.`);
      if (!ok) {
        missing.push(`python3 satisfying '${manifest.runtime.python}'`);
        messages.push(`Python ${detected.python} does not satisfy '${manifest.runtime.python}'.`);
      }
    }
  } else if (lang === "node") {
    if (!detected.node) {
      missing.push("node (>=18)");
      messages.push("Node.js not found.");
    } else {
      const ok = versionSatisfies(detected.node.replace(/^v/, ""), manifest.runtime.node);
      messages.push(`Node ${detected.node.replace(/^v/, "")} detected.`);
      if (!ok) {
        missing.push(`node satisfying '${manifest.runtime.node}'`);
        messages.push(`Node ${detected.node} does not satisfy '${manifest.runtime.node}'.`);
      }
    }
  } else {
    messages.push(`Language '${lang}' has no version check.`);
  }

  if (manifest.runtime.sandbox === "container" && !detected.docker) {
    missing.push("docker (agent requires container sandbox)");
    messages.push("Agent requires a container sandbox but Docker is not available.");
  }

  if ((manifest.permissions ?? []).includes("browser") && !detected.git) {
    // git used as a proxy signal; browser automation needs a runtime, not git.
  }

  return { satisfied: missing.length === 0, missing, messages };
}

export interface SandboxStrategy {
  mode: "container" | "isolated-process";
  reason: string;
}

export function decideSandbox(
  manifest: Manifest,
  detected: DetectedRuntime,
  trustLevel: "trusted" | "untrusted" | "unknown" | "local",
): SandboxStrategy {
  const requested = manifest.runtime.sandbox ?? "auto";
  if (requested === "container") {
    return { mode: "container", reason: "manifest requests container sandbox" };
  }
  if (requested === "isolated-process") {
    return { mode: "isolated-process", reason: "manifest requests isolated-process sandbox" };
  }
  if (trustLevel === "untrusted") {
    return { mode: "container", reason: "agent is untrusted; requires container isolation" };
  }
  if (trustLevel === "unknown") {
    return { mode: "container", reason: "trust unknown; defaulting to container isolation" };
  }
  return { mode: "isolated-process", reason: "trusted or local agent; using fast isolated-process path" };
}
