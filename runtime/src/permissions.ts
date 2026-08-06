import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Manifest, Permission } from "@openagenthub/sdk";
import { CONFIG_PATH } from "./config.js";

export type GrantedPermissions = Record<string, boolean>;

export interface OpenAgentHubConfig {
  registryUrl?: string;
  token?: string;
  installed?: Record<string, InstalledAgent>;
  permissions?: Record<string, GrantedPermissions>;
  secretGrants?: Record<string, string[]>;
  sandboxOverrides?: Record<string, SandboxOverrideEntry>;
}

export interface SandboxOverrideEntry {
  sandbox: "container" | "process";
  digest: string;
  setAt: string;
}

export interface InstalledAgent {
  name: string;
  namespace: string;
  version: string;
  author: string;
  trust: "trusted" | "untrusted" | "unknown" | "local";
  installedAt: string;
  source: string;
  signatureKeyId?: string;
  reviewStatus?: string;
  statusCheckedAt?: string;
  archiveDigest?: string;
}

export class ConfigCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigCorruptError";
  }
}

export function loadConfig(): OpenAgentHubConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    throw new ConfigCorruptError(
      `cannot read config ${CONFIG_PATH}: ${(err as Error).message}\nrecovery: restore the file from backup, or move it aside with:\n  mv ${CONFIG_PATH} ${CONFIG_PATH}.corrupt-$(date +%s)\n(reinstalling agents will recreate a fresh config)`,
    );
  }
  try {
    return JSON.parse(raw) as OpenAgentHubConfig;
  } catch {
    throw new ConfigCorruptError(
      `config ${CONFIG_PATH} is not valid JSON; refusing to treat it as empty (would silently lose installed agents and grants)\nrecovery: move it aside and reinstall agents:\n  mv ${CONFIG_PATH} ${CONFIG_PATH}.corrupt-$(date +%s)\n(reinstalling agents will recreate a fresh config)`,
    );
  }
}

export function saveConfig(config: OpenAgentHubConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, CONFIG_PATH);
}

export function recordInstall(config: OpenAgentHubConfig, agent: InstalledAgent): void {
  config.installed = config.installed ?? {};
  config.installed[`${agent.namespace}/${agent.name}@${agent.version}`] = agent;
  saveConfig(config);
}

export function recordStatusRefresh(
  config: OpenAgentHubConfig,
  key: string,
  status: { reviewStatus?: string; blockedReason?: string },
): void {
  const record = config.installed?.[key];
  if (!record) return;
  record.reviewStatus = status.reviewStatus;
  record.statusCheckedAt = new Date().toISOString();
  saveConfig(config);
}

export function grantedPermissions(config: OpenAgentHubConfig, agentKey: string): GrantedPermissions {
  return config.permissions?.[agentKey] ?? {};
}

export function saveGrantedPermissions(config: OpenAgentHubConfig, agentKey: string, perms: GrantedPermissions): void {
  config.permissions = config.permissions ?? {};
  config.permissions[agentKey] = perms;
  saveConfig(config);
}

export function requestedPermissions(manifest: { permissions?: Permission[] }): Permission[] {
  const perms = manifest.permissions ?? [];
  if (perms.includes("none")) return ["none"];
  return perms;
}

export function effectivePermissions(manifest: { permissions?: Permission[] }, saved: GrantedPermissions): Permission[] {
  const requested = requestedPermissions(manifest);
  if (requested.length === 1 && requested[0] === "none") return [];
  const allowed = new Set(requested);
  return Object.entries(saved)
    .filter(([k, v]) => v === true && allowed.has(k as Permission))
    .map(([k]) => k as Permission);
}

export function unsupportedSavedGrants(manifest: { permissions?: Permission[] }, saved: GrantedPermissions): string[] {
  const requested = new Set(requestedPermissions(manifest));
  return Object.keys(saved).filter((k) => !requested.has(k as Permission));
}

export function networkGranted(perms: GrantedPermissions): boolean {
  return perms.network === true;
}

export function grantedSecretNames(agentKey: string, config: OpenAgentHubConfig): Set<string> {
  return new Set(config.secretGrants?.[agentKey] ?? []);
}

export function saveSecretGrant(config: OpenAgentHubConfig, agentKey: string, secret: string): void {
  config.secretGrants = config.secretGrants ?? {};
  const grants = config.secretGrants[agentKey] ?? (config.secretGrants[agentKey] = []);
  if (!grants.includes(secret)) grants.push(secret);
  saveConfig(config);
}

export function sandboxOverride(config: OpenAgentHubConfig, agentKey: string): SandboxOverrideEntry | undefined {
  return config.sandboxOverrides?.[agentKey];
}

export function setSandboxOverride(config: OpenAgentHubConfig, agentKey: string, sandbox: "container" | "process", digest: string): void {
  config.sandboxOverrides = config.sandboxOverrides ?? {};
  config.sandboxOverrides[agentKey] = { sandbox, digest, setAt: new Date().toISOString() };
  saveConfig(config);
}

export function clearSandboxOverride(config: OpenAgentHubConfig, agentKey: string): boolean {
  if (!config.sandboxOverrides?.[agentKey]) return false;
  delete config.sandboxOverrides[agentKey];
  saveConfig(config);
  return true;
}
