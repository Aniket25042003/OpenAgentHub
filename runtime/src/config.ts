import { homedir } from "node:os";
import { join } from "node:path";

export const AGENT_HOME = process.env.AGENT_HOME ?? join(homedir(), ".openagenthub");
export const AGENTS_DIR = join(AGENT_HOME, "agents");
export const CONFIG_PATH = join(AGENT_HOME, "config.json");
export const KEYS_DIR = join(AGENT_HOME, "keys");
export const SECRETS_DIR = join(AGENT_HOME, "secrets");
export const MASTER_KEY_PATH = join(AGENT_HOME, "master.key");
export const REGISTRY_DEFAULT = "https://registry.openagenthub.dev";

export interface AgentKey {
  namespace: string;
  name: string;
  version: string;
}

export function agentKeyToString(k: AgentKey): string {
  return `${k.namespace}/${k.name}@${k.version}`;
}

export function installedAgentDir(k: AgentKey): string {
  return join(AGENTS_DIR, k.namespace, k.name, k.version);
}
