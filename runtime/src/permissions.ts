import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Permission } from "@openagenthub/sdk";
import { CONFIG_PATH } from "./config.js";

export type GrantedPermissions = Record<string, boolean>;

export interface OpenAgentHubConfig {
  registryUrl?: string;
  token?: string;
  installed?: Record<string, InstalledAgent>;
  permissions?: Record<string, GrantedPermissions>;
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
}

export function loadConfig(): OpenAgentHubConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as OpenAgentHubConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: OpenAgentHubConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function recordInstall(config: OpenAgentHubConfig, agent: InstalledAgent): void {
  config.installed = config.installed ?? {};
  config.installed[`${agent.namespace}/${agent.name}@${agent.version}`] = agent;
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

export function networkGranted(perms: GrantedPermissions): boolean {
  return perms.network === true;
}
