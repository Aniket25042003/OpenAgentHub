import { homedir } from "node:os";
import { join } from "node:path";

export const AGENT_HOME = process.env.AGENT_HOME ?? join(homedir(), ".openagenthub");
export const AGENTS_DIR = join(AGENT_HOME, "agents");
export const CONFIG_PATH = join(AGENT_HOME, "config.json");
export const KEYS_DIR = join(AGENT_HOME, "keys");
export const SECRETS_DIR = join(AGENT_HOME, "secrets");
export const MASTER_KEY_PATH = join(AGENT_HOME, "master.key");
export const REGISTRY_DEFAULT = "https://registry.openagenthub.dev";

export const CONTROL_DIR = join(AGENT_HOME, "control-plane");
export const CONTROL_STATE_PATH = join(CONTROL_DIR, "state.json");
export const CONTROL_TOKEN_PATH = join(CONTROL_DIR, "token");
export const CONTROL_LOCK_DIR = join(CONTROL_DIR, "lock");
export const CONTROL_LOG_PATH = join(CONTROL_DIR, "daemon.log");
export const CONTROL_PREFERRED_PORT = 31777;
export const CONTROL_PROTOCOL_VERSION = 1;
export const CONTROL_BOUND_HOST = "127.0.0.1";

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
