import type { InstalledAgent, OpenAgentHubConfig } from "@openagenthub/runtime";
import { compareVersions, highestVersion } from "./version.js";

export interface InstalledMatch {
  key: string;
  record: InstalledAgent;
}

export function installedMatches(config: OpenAgentHubConfig, namespace: string, name: string): InstalledMatch[] {
  const prefix = `${namespace}/${name}@`;
  return Object.entries(config.installed ?? {})
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, record]) => ({ key, record }))
    .sort((a, b) => compareVersions(a.record.version, b.record.version));
}

export function resolveInstalledOrThrow(
  config: OpenAgentHubConfig,
  namespace: string,
  name: string,
  version: string | undefined,
): InstalledMatch {
  const matches = installedMatches(config, namespace, name);
  if (matches.length === 0) {
    throw new Error(`agent '${namespace}/${name}${version ? `@${version}` : ""}' is not installed`);
  }
  if (version) {
    const exact = matches.find((m) => m.record.version === version);
    if (!exact) throw new Error(`agent '${namespace}/${name}@${version}' is not installed`);
    return exact;
  }
  return matches[matches.length - 1];
}

export function highestInstalledVersion(matches: InstalledMatch[]): string | undefined {
  return highestVersion(matches.map((m) => m.record.version));
}
