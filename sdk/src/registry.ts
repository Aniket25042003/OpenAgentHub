import { RegistryError } from "./errors.js";
import type { Manifest } from "./manifest.js";
import type { SignatureFile } from "./package.js";

export interface SearchOptions {
  q?: string;
  framework?: string;
  tags?: string;
  models?: string;
  sort?: "downloads" | "trending" | "newest";
  limit?: number;
  offset?: number;
}

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

export interface AgentVersionDetail {
  name: string;
  version: string;
  author: string;
  description: string;
  manifest: Manifest;
  publishedAt: string;
  downloadCount: number;
  trust: "trusted" | "untrusted" | "unknown";
  signature?: SignatureFile;
  security?: SecurityReportSummary;
  yanked?: boolean;
  signerKey?: {
    id: number;
    fingerprint: string;
    label?: string;
    revoked: boolean;
    expired: boolean;
  };
  reviewStatus?: "pending" | "verified" | "warning" | "rejected" | "revoked";
  reviewedAt?: string;
  reviewReason?: string;
}

export interface RevocationItem {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  reason: string;
  reviewStatus: string;
  securityStatus: string;
  updatedAt: string;
}

export interface SecurityReportSummary {
  status: "clean" | "flagged" | "pending" | "failed";
  findings: string[];
}

export interface CatalogItem {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  author: string;
  description: string;
  license: string;
  framework?: string;
  models: string[];
  tags: string[];
  runtime?: string;
  interfaces: string[];
  permissions: string[];
  secrets: string[];
  downloads: number;
  publisher: string;
  signerVerified: boolean;
  reviewStatus: string;
  securityStatus: string;
  yanked: boolean;
  publishedAt: string;
  reviewedAt?: string;
}

export interface CatalogOptions {
  q?: string;
  framework?: string;
  models?: string;
  tags?: string;
  reviewStatus?: string;
  securityStatus?: string;
  permission?: string;
  runtime?: string;
  publisherStatus?: "verified" | "unverified";
  cursor?: string;
  limit?: number;
}

export interface CatalogPage {
  schemaVersion: number;
  watermark: string;
  items: CatalogItem[];
  nextCursor?: string;
}

const DEFAULT_TIMEOUT = 30_000;
const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;

export class RegistryClient {
  constructor(
    readonly baseUrl: string,
    readonly token?: string,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      };
      if (init.headers) {
        const h = init.headers as Record<string, string>;
        for (const k of Object.keys(h)) headers[k] = h[k];
      }
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const body = (await res.json()) as { detail?: string | string[] };
          detail = Array.isArray(body.detail) ? body.detail.join("; ") : (body.detail ?? detail);
        } catch {
          /* ignore */
        }
        throw new RegistryError(`${res.status} ${path}: ${detail}`, res.status);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async search(opts: SearchOptions): Promise<AgentSummary[]> {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.framework) params.set("framework", opts.framework);
    if (opts.tags) params.set("tags", opts.tags);
    if (opts.models) params.set("models", opts.models);
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    const res = await this.request(`/api/v1/agents?${params.toString()}`);
    const data = (await res.json()) as { items: AgentSummary[] };
    return data.items;
  }

  async catalog(opts: CatalogOptions = {}): Promise<CatalogPage> {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.framework) params.set("framework", opts.framework);
    if (opts.models) params.set("models", opts.models);
    if (opts.tags) params.set("tags", opts.tags);
    if (opts.reviewStatus) params.set("review_status", opts.reviewStatus);
    if (opts.securityStatus) params.set("security_status", opts.securityStatus);
    if (opts.permission) params.set("permission", opts.permission);
    if (opts.runtime) params.set("runtime", opts.runtime);
    if (opts.publisherStatus) params.set("publisher_status", opts.publisherStatus);
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    const res = await this.request(`/api/v1/catalog?${params.toString()}`);
    return (await res.json()) as CatalogPage;
  }

  async get(namespace: string, name: string): Promise<AgentSummary> {
    const res = await this.request(`/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
    return (await res.json()) as AgentSummary;
  }

  async getVersion(namespace: string, name: string, version: string): Promise<AgentVersionDetail> {
    const res = await this.request(
      `/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
    );
    return (await res.json()) as AgentVersionDetail;
  }

  async listVersions(namespace: string, name: string): Promise<string[]> {
    const res = await this.request(`/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions`);
    const data = (await res.json()) as { versions: string[] };
    return data.versions;
  }

  async downloadArchive(namespace: string, name: string, version: string): Promise<{ buffer: Buffer; sha256: string; signature: SignatureFile }> {
    const detail = await this.getVersion(namespace, name, version);
    if (!detail.signature) throw new RegistryError("version has no published signature", 409);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/archive`,
        { signal: controller.signal, headers: { Accept: "application/octet-stream" } },
      );
      if (!res.ok) throw new RegistryError(`download failed: ${res.status}`, res.status);
      if (!res.body) throw new RegistryError("empty download", 500);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_DOWNLOAD_BYTES) throw new RegistryError("archive exceeds download limit", 413);
        chunks.push(value);
      }
      return { buffer: Buffer.concat(chunks), sha256: detail.signature.sha256, signature: detail.signature };
    } finally {
      clearTimeout(timer);
    }
  }

  async publish(
    namespace: string,
    name: string,
    version: string,
    archive: Buffer,
    signature: SignatureFile,
  ): Promise<{ security: string; findings: string[] }> {
    const fd = new FormData();
    fd.set("archive", new Blob([archive]), `${name}-${version}.ahb`);
    fd.set("signature", new Blob([JSON.stringify(signature)]), "signature.sig.json");
    const res = await this.request(`/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`, {
      method: "PUT",
      body: fd,
    });
    return (await res.json()) as { security: string; findings: string[] };
  }

  async triggerScan(namespace: string, name: string, version: string): Promise<void> {
    await this.request(
      `/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/scan`,
      { method: "POST" },
    );
  }

  async getRevocations(): Promise<RevocationItem[]> {
    const res = await this.request("/api/v1/revocations");
    const data = (await res.json()) as { items: RevocationItem[] };
    return data.items;
  }

  async me(): Promise<{
    username: string;
    role: string;
    status: string;
    publicKeys: {
      id: number;
      fingerprint: string;
      label?: string;
      revoked: boolean;
      expired: boolean;
    }[];
  }> {
    const res = await this.request("/api/v1/me");
    return (await res.json()) as {
      username: string;
      role: string;
      status: string;
      publicKeys: {
        id: number;
        fingerprint: string;
        label?: string;
        revoked: boolean;
        expired: boolean;
      }[];
    };
  }

  async revokePublicKey(keyId: number): Promise<void> {
    await this.request(`/api/v1/keys/${keyId}`, { method: "DELETE" });
  }

  async uploadPublicKey(publicKeyPem: string, label?: string, expiresAt?: string): Promise<void> {
    const res = await this.request("/api/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: publicKeyPem, label, expiresAt }),
    });
    await res.json();
  }

  async exchangeGitHubToken(code: string): Promise<{ token: string }> {
    const res = await this.request("/api/v1/auth/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return (await res.json()) as { token: string };
  }
}
