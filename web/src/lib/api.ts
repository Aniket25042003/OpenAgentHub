export interface AgentSummary {
  namespace: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
  framework?: string;
  models: string[];
  tags: string[];
  downloads: number;
  trust: "trusted" | "untrusted" | "unknown";
}

export interface SecurityReport {
  status: "clean" | "flagged" | "pending" | "failed";
  findings: string[];
}

export interface AgentVersionDetail {
  name: string;
  version: string;
  author: string;
  description: string;
  manifest: Record<string, unknown>;
  publishedAt: string;
  downloadCount: number;
  trust: "trusted" | "untrusted" | "unknown";
  signature?: {
    publicKeyId: string;
    sha256: string;
  };
  security?: SecurityReport;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const REGISTRY_URL = (process.env.NEXT_PUBLIC_REGISTRY_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function request<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(`${REGISTRY_URL}${path}`, { next: { revalidate } });
  if (!res.ok) {
    throw new ApiError(`${res.status} ${path}`, res.status);
  }
  return (await res.json()) as T;
}

export async function searchAgents(q?: string): Promise<AgentSummary[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("sort", "downloads");
  const data = await request<{ items: AgentSummary[] }>(`/api/v1/agents?${params.toString()}`);
  return data.items;
}

export async function getAgent(namespace: string, name: string): Promise<AgentSummary> {
  return request<AgentSummary>(`/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
}

export async function getAgentVersion(
  namespace: string,
  name: string,
  version = "latest",
): Promise<AgentVersionDetail> {
  return request<AgentVersionDetail>(
    `/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
  );
}

export function registryUrl(): string {
  return REGISTRY_URL;
}
