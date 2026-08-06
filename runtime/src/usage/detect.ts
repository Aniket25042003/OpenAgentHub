import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderName, ProviderSource } from "./types.js";

const ENV_ROOTS: Record<ProviderName, string[]> = {
  claude: ["OPENAGENTHUB_CLAUDE_DIR", "CLAUDE_CONFIG_DIR"],
  codex: ["OPENAGENTHUB_CODEX_DIR", "CODEX_HOME"],
  opencode: ["OPENAGENTHUB_OPENCODE_DIR", "OPENCODE_DATA"],
};

const SOURCES: Record<ProviderName, Omit<ProviderSource, "root" | "dataDir" | "files" | "endpoints"> & { dataDir: string; files: string[]; endpoints: string[] }> = {
  claude: {
    provider: "claude",
    displayName: "Claude Code",
    description: "Incrementally parses Claude Code session JSONL records in ~/.claude/projects.",
    dataDir: "projects",
    files: ["session JSONL files under <root>/projects"],
    endpoints: [],
  },
  codex: {
    provider: "codex",
    displayName: "Codex CLI",
    description: "Parses Codex session/rollout JSONL records in ~/.codex/sessions.",
    dataDir: "sessions",
    files: ["session JSONL files under <root>/sessions"],
    endpoints: [],
  },
  opencode: {
    provider: "opencode",
    displayName: "OpenCode",
    description: "Reads the OpenCode SQLite storage database read-only.",
    dataDir: "storage",
    files: ["SQLite databases under <root>/storage"],
    endpoints: [],
  },
};

export function providerRoot(provider: ProviderName): string | null {
  for (const env of ENV_ROOTS[provider]) {
    const v = process.env[env];
    if (v) return v;
  }
  const home = homedir();
  if (provider === "claude") return join(home, ".claude");
  if (provider === "codex") return join(home, ".codex");
  return join(home, ".local", "share", "opencode");
}

export function providerSource(provider: ProviderName): ProviderSource {
  const root = providerRoot(provider);
  const base = SOURCES[provider];
  return {
    ...base,
    root: root ?? "",
    dataDir: root ? join(root, base.dataDir) : "",
    files: base.files,
    endpoints: base.endpoints,
  };
}

export function providerDetected(provider: ProviderName): boolean {
  const root = providerRoot(provider);
  return root !== null && existsSync(root);
}

export function providerEnabled(settings: (key: string) => string | null, provider: ProviderName): boolean {
  const v = settings(`integration.${provider}.enabled`);
  return v === null || v === "1";
}

export function hasConsent(settings: (key: string) => string | null, provider: ProviderName, kind: "credentials" | "live"): boolean {
  return settings(`integration.${provider}.${kind}`) === "1";
}

export const EXPERIMENTAL_ENV = "OPENAGENTHUB_EXPERIMENTAL";

export function experimentalEnabled(): boolean {
  return process.env[EXPERIMENTAL_ENV] === "1";
}
