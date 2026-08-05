import { loadConfig, saveConfig, SecretsVault, REGISTRY_DEFAULT } from "@openagenthub/runtime";

export interface CliCredential {
  accessToken: string;
  username: string;
  registryUrl: string;
  tokenType: string;
  storedAt: string;
}

const VAULT_KEY = "openagenthub:cli-auth";

export function registryOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export function resolveRegistryUrl(flag?: string): string {
  if (flag) return flag;
  const config = loadConfig();
  return config.registryUrl ?? REGISTRY_DEFAULT;
}

export function getCredential(registryUrl: string): CliCredential | null {
  const vault = SecretsVault.open();
  try {
    const all = vault.get(VAULT_KEY);
    const raw = all[registryOrigin(registryUrl)];
    if (!raw) return null;
    return JSON.parse(raw) as CliCredential;
  } catch {
    return null;
  }
}

export function saveCredential(cred: CliCredential): void {
  const vault = SecretsVault.open();
  const all = vault.get(VAULT_KEY);
  all[registryOrigin(cred.registryUrl)] = JSON.stringify(cred);
  vault.set(VAULT_KEY, all);
}

export function deleteCredential(registryUrl: string): void {
  const vault = SecretsVault.open();
  const all = vault.get(VAULT_KEY);
  all[registryOrigin(registryUrl)] = "";
  vault.set(VAULT_KEY, all);
}

export function hasCredential(registryUrl: string): boolean {
  return getCredential(registryUrl) !== null;
}

export function resolveToken(registryUrl: string): string | undefined {
  const cred = getCredential(registryUrl);
  if (cred?.accessToken) return cred.accessToken;
  return loadConfig().token;
}