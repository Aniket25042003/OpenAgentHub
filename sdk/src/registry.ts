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

export interface PublisherOverview {
  namespaceCount: number;
  packageCount: number;
  keyCount: number;
  activeSessions: number;
  publishesUsed: number;
  publishesLimit: number;
  publishesUnlimited: boolean;
  pendingScans: number;
  flaggedVersions: number;
}

export interface PublisherNamespace {
  name: string;
  role: string;
  memberCount: number;
  packageCount: number;
  createdAt: string;
}

export interface PackageSummary {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  author: string;
  description: string;
  license: string;
  publishedAt: string;
  downloads: number;
  trust: "trusted" | "untrusted" | "unknown";
  reviewStatus: string;
  securityStatus: string;
  yanked: boolean;
  blocked?: string;
  signerFingerprint?: string;
}

export interface SecurityDiffField {
  field: string;
  previous?: string;
  current?: string;
}

export interface SecurityDiff {
  fields: SecurityDiffField[];
  addedPermissions: string[];
  removedPermissions: string[];
  addedSecrets: string[];
  removedSecrets: string[];
}

export interface ReviewEventItem {
  action: string;
  reason: string;
  notes?: string;
  reviewer: string;
  createdAt: string;
  digest: string;
  signerFingerprint?: string;
}

export interface VersionIdentity {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  signerFingerprint?: string;
  publishedAt: string;
  publishedBy: string;
  downloadCount: number;
  trust: "trusted" | "untrusted" | "unknown";
  reviewStatus: string;
  reviewReason?: string;
  securityStatus: string;
  securityFindings: string[];
  yanked: boolean;
  blocked: boolean;
  blockedReason?: string;
}

export interface VersionIdentityDetail {
  identity: VersionIdentity;
  manifest: Record<string, unknown>;
  securityDiff: SecurityDiff;
  reviewHistory: ReviewEventItem[];
}

export interface ActivityItem {
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ReviewQueueItem {
  id: number;
  namespace: string;
  name: string;
  version: string;
  digest: string;
  publishedAt: string;
  publisher: string;
  signerFingerprint?: string;
  reviewStatus: string;
  securityStatus: string;
  riskScore: number;
  permissions: string[];
  secrets: string[];
  downloads: number;
}

export type ReviewAction = "verify" | "warning" | "reject" | "revoke" | "request";

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

  async getDownloadUrl(namespace: string, name: string, version: string): Promise<{ url: string; expiresInSeconds: number; version: string }> {
    const res = await this.request(
      `/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/download-url`,
      { method: "POST" },
    );
    return (await res.json()) as { url: string; expiresInSeconds: number; version: string };
  }

  async downloadArchive(namespace: string, name: string, version: string): Promise<{ buffer: Buffer; sha256: string; signature: SignatureFile }> {
    const detail = await this.getVersion(namespace, name, version);
    if (!detail.signature) throw new RegistryError("version has no published signature", 409);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      let url = `${this.baseUrl}/api/v1/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/archive`;
      let headers: Record<string, string> = { Accept: "application/octet-stream" };
      if (this.token) {
        const { url: signed } = await this.getDownloadUrl(namespace, name, version);
        url = signed;
        headers = {};
      }
      const res = await fetch(url, { signal: controller.signal, headers });
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

  async startDeviceLogin(clientName = "cli"): Promise<DeviceLoginStart> {
    const res = await this.request("/api/v1/auth/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName }),
    });
    return (await res.json()) as DeviceLoginStart;
  }

  async pollDeviceToken(deviceCode: string): Promise<DeviceTokenResult> {
    let res: Response;
    try {
      res = await this.request("/api/v1/auth/devices/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode }),
      });
    } catch (err) {
      if (err instanceof RegistryError && err.status === 400) {
        const detail = err.message.split(": ").pop() ?? "authorization_pending";
        throw new DeviceAuthPendingError(detail);
      }
      throw err;
    }
    return (await res.json()) as DeviceTokenResult;
  }

  async mySessions(): Promise<SessionInfo[]> {
    const res = await this.request("/api/v1/sessions");
    const data = (await res.json()) as { sessions: SessionInfo[] };
    return data.sessions;
  }

  async revokeSession(sessionId: number): Promise<void> {
    await this.request(`/api/v1/sessions/${sessionId}`, { method: "DELETE" });
  }

  async logoutMe(): Promise<void> {
    await this.request("/api/v1/sessions/me", { method: "DELETE" });
  }

  async myAgreements(): Promise<AgreementsInfo> {
    const res = await this.request("/api/v1/me/agreements");
    return (await res.json()) as AgreementsInfo;
  }

  async acceptAgreements(tos: boolean, privacy: boolean, publisher: boolean): Promise<AgreementsInfo> {
    const res = await this.request("/api/v1/me/agreements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tos, privacy, publisher }),
    });
    return (await res.json()) as AgreementsInfo;
  }

  async logout(): Promise<void> {
    await this.request("/api/v1/logout", { method: "POST" });
  }

  async publisherOverview(): Promise<PublisherOverview> {
    const res = await this.request("/api/v1/me/overview");
    return (await res.json()) as PublisherOverview;
  }

  async publisherNamespaces(): Promise<PublisherNamespace[]> {
    const res = await this.request("/api/v1/me/namespaces");
    return (await res.json()) as PublisherNamespace[];
  }

  async publisherPackages(): Promise<PackageSummary[]> {
    const res = await this.request("/api/v1/me/packages");
    return (await res.json()) as PackageSummary[];
  }

  async versionIdentity(namespace: string, name: string, version: string): Promise<VersionIdentityDetail> {
    const res = await this.request(
      `/api/v1/me/packages/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
    );
    return (await res.json()) as VersionIdentityDetail;
  }

  async publisherActivity(): Promise<ActivityItem[]> {
    const res = await this.request("/api/v1/me/activity");
    const data = (await res.json()) as { items: ActivityItem[] };
    return data.items;
  }

  async reviewQueue(): Promise<ReviewQueueItem[]> {
    const res = await this.request("/api/v1/admin/review-queue");
    const data = (await res.json()) as { items: ReviewQueueItem[] };
    return data.items;
  }

  async reviewVersion(
    namespace: string,
    name: string,
    version: string,
    action: ReviewAction,
    reason: string,
    notes?: string,
  ): Promise<{ status: string }> {
    const res = await this.request(
      `/api/v1/admin/agents/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, notes }),
      },
    );
    return (await res.json()) as { status: string };
  }
}

export interface DeviceLoginStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceTokenResult {
  accessToken: string;
  username: string;
  tokenType: string;
}

export interface SessionInfo {
  id: number;
  audience: string;
  deviceLabel?: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface AgreementsInfo {
  tos: string;
  privacy: string;
  publisher: string;
}

export class DeviceAuthPendingError extends RegistryError {
  constructor(message: string) {
    super(message, 400);
    this.name = "DeviceAuthPendingError";
  }
}
