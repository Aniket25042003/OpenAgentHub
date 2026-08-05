import { RegistryClient } from "@openagenthub/sdk";
import {
  loadConfig,
  type InstalledAgent,
} from "@openagenthub/runtime";

export interface RevocationCheck {
  blocked?: string;
  staleWarning?: string;
  statusFresh: boolean;
}

const STATUS_FRESH_MS = 60 * 60 * 1000;

export function installedIsFresh(installed: InstalledAgent): boolean {
  if (!installed.statusCheckedAt) return false;
  return Date.now() - new Date(installed.statusCheckedAt).getTime() < STATUS_FRESH_MS;
}

export async function checkRevocationBeforeRun(
  agentKey: string,
  installed: InstalledAgent,
  registryUrl: string,
  token?: string,
): Promise<RevocationCheck> {
  if (!registryUrl) return { statusFresh: false };
  if (installedIsFresh(installed)) return { statusFresh: true };

  const client = new RegistryClient(registryUrl, token);
  let items;
  try {
    items = await client.getRevocations();
  } catch {
    return {
      statusFresh: false,
      staleWarning: `cannot reach ${registryUrl} to refresh status; last known review status is '${
        installed.reviewStatus ?? "unknown"
      }'`,
    };
  }

  const match = items.find(
    (i) =>
      i.namespace === installed.namespace &&
      i.name === installed.name &&
      (i.version === installed.version || i.digest === installed.archiveDigest),
  );
  if (match) {
    return { blocked: `agent was ${match.reviewStatus} by the registry: ${match.reason}`, statusFresh: true };
  }
  return { statusFresh: true };
}
