export type AgentStatus = "running" | "installed" | "unknown";

export type DetectionSource = "process" | "container" | "config" | "binary" | "port";

export interface KnownAgentSpec {
  id: string;
  displayName: string;
  description: string;
  homepage?: string;
  processPatterns: string[];
  binaries: string[];
  configPaths: string[];
  containerNamePatterns: string[];
  containerImagePatterns: string[];
  ports: number[];
}

export interface AgentProcess {
  pid: number;
  command: string;
}

export interface DetectedAgent {
  id: string;
  displayName: string;
  description: string;
  homepage?: string;
  status: AgentStatus;
  detectedVia: DetectionSource[];
  processes: AgentProcess[];
  containerNames: string[];
  configPaths: string[];
  listeningPorts: number[];
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  command: string;
  state: string;
  status: string;
  ports: string;
  created: string;
  labels: string;
  mounts: string;
  matchedAgentId?: string;
  managedBy?: "openagenthub" | "third-party";
}

export interface OahInstalledAgent {
  spec: string;
  version: string;
  author: string;
  trust: string;
  installedAt: string;
  source: string;
  path: string;
}

export interface HostInfo {
  hostname: string;
  platform: string;
  arch: string;
  cpus: number;
  uptimeSec: number;
  loadavg: number[];
  memTotalBytes: number;
  memFreeBytes: number;
  node: string;
  python?: string;
  docker: { available: boolean; version?: string; error?: string };
}

export interface SystemSnapshot {
  generatedAt: string;
  host: HostInfo;
  openagenthub: {
    version: string;
    agentsDir: string;
    registryUrl: string;
    installed: OahInstalledAgent[];
  };
  agents: DetectedAgent[];
  containers: ContainerInfo[];
}
