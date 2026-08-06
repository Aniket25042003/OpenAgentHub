from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel

TrustLevel = Literal["trusted", "untrusted", "unknown"]
SecurityStatus = Literal["clean", "flagged", "pending", "failed"]


class AgentSummary(BaseModel):
    namespace: str
    name: str
    version: str
    author: str
    description: str
    license: str
    framework: str | None = None
    models: list[str]
    tags: list[str]
    downloads: int
    trust: TrustLevel = "unknown"


class SecurityReport(BaseModel):
    status: SecurityStatus
    findings: list[str]


class SignatureFile(BaseModel):
    schemaVersion: int
    name: str
    version: str
    algorithm: Literal["ed25519"]
    publicKey: str
    publicKeyId: str
    sha256: str
    signature: str


class SignerKeyInfo(BaseModel):
    id: int
    fingerprint: str
    label: str | None = None
    revoked: bool = False
    expired: bool = False

    @classmethod
    def from_key(cls, key) -> "SignerKeyInfo":
        expired = False
        if key.expires_at is not None:
            expires = key.expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            expired = expires <= datetime.now(timezone.utc)
        return cls(
            id=key.id,
            fingerprint=key.fingerprint,
            label=key.label,
            revoked=key.revoked_at is not None,
            expired=expired,
        )


class AgentVersionDetail(BaseModel):
    name: str
    version: str
    author: str
    description: str
    manifest: dict[str, Any]
    publishedAt: str
    downloadCount: int
    trust: TrustLevel
    signature: SignatureFile | None = None
    security: SecurityReport | None = None
    yanked: bool = False
    signerKey: SignerKeyInfo | None = None
    reviewStatus: str = "pending"
    reviewedAt: str | None = None
    reviewReason: str | None = None


class ReviewRequest(BaseModel):
    action: Literal["verify", "warning", "reject", "revoke", "request"]
    reason: str
    notes: str | None = None


class RevocationItem(BaseModel):
    namespace: str
    name: str
    version: str
    digest: str
    reason: str
    reviewStatus: str
    securityStatus: str
    updatedAt: str


class RevocationFeedResponse(BaseModel):
    items: list[RevocationItem]


class SearchResponse(BaseModel):
    items: list[AgentSummary]


class CatalogItem(BaseModel):
    namespace: str
    name: str
    version: str
    digest: str
    author: str
    description: str
    license: str
    framework: str | None = None
    models: list[str]
    tags: list[str]
    runtime: str | None = None
    interfaces: list[str] = []
    permissions: list[str] = []
    secrets: list[str] = []
    downloads: int
    publisher: str
    signerVerified: bool = False
    reviewStatus: str = "pending"
    securityStatus: str = "pending"
    yanked: bool = False
    publishedAt: str
    reviewedAt: str | None = None


class CatalogCursor(BaseModel):
    key: str
    version: str
    id: int


class CatalogResponse(BaseModel):
    schemaVersion: int = 1
    watermark: str
    items: list[CatalogItem] | None = None
    nextCursor: str | None = None


class VersionsResponse(BaseModel):
    versions: list[str]


class MeResponse(BaseModel):
    username: str
    role: str = "publisher"
    status: str = "active"
    publicKeys: list[SignerKeyInfo]


class UploadKeyRequest(BaseModel):
    publicKey: str
    label: str | None = None
    expiresAt: datetime | None = None


class GithubExchangeRequest(BaseModel):
    code: str


class GithubExchangeResponse(BaseModel):
    token: str
    username: str


class DeviceLoginRequest(BaseModel):
    clientName: str = "cli"
    requestedScopes: str = "cli"
    registryOrigin: str | None = None
    mode: str = "poll"


class DeviceLoginResponse(BaseModel):
    deviceCode: str
    userCode: str
    verificationUri: str
    expiresIn: int
    interval: int


class DevicePollRequest(BaseModel):
    deviceCode: str


class DevicePollResponse(BaseModel):
    accessToken: str
    username: str
    tokenType: str = "bearer"


class AgreementsRequest(BaseModel):
    tos: bool = False
    privacy: bool = False
    publisher: bool = False


class SessionInfo(BaseModel):
    id: int
    audience: str
    deviceLabel: str | None = None
    createdAt: str
    lastUsedAt: str
    expiresAt: str
    revoked: bool = False


class SessionsResponse(BaseModel):
    sessions: list[SessionInfo]


class AuthMeResponse(BaseModel):
    username: str
    role: str = "publisher"
    status: str = "active"
    githubId: str | None = None
    avatarUrl: str | None = None
    agreements: dict[str, str]
    sessions: list[SessionInfo]


class NamespaceClaimRequest(BaseModel):
    name: str


class MaintainerAddRequest(BaseModel):
    username: str
    role: str = "maintainer"


class SuspendRequest(BaseModel):
    suspended: bool


class YankRequest(BaseModel):
    yanked: bool


class NamespaceInfo(BaseModel):
    name: str
    role: str
    memberCount: int
    packageCount: int
    createdAt: str


class PackageSummary(BaseModel):
    namespace: str
    name: str
    version: str
    digest: str
    author: str
    description: str
    license: str
    publishedAt: str
    downloads: int
    trust: TrustLevel
    reviewStatus: str
    securityStatus: str
    yanked: bool
    blocked: str | None = None
    signerFingerprint: str | None = None


class PublisherPackageList(BaseModel):
    items: list[PackageSummary]


class SecurityDiffField(BaseModel):
    field: str
    previous: str | None = None
    current: str | None = None


class VersionIdentity(BaseModel):
    namespace: str
    name: str
    version: str
    digest: str
    signerFingerprint: str | None = None
    publishedAt: str
    publishedBy: str
    downloadCount: int
    trust: TrustLevel
    reviewStatus: str
    reviewReason: str | None = None
    securityStatus: str
    securityFindings: list[str] = []
    yanked: bool
    blocked: bool = False
    blockedReason: str | None = None
    scanRequestedAt: str | None = None
    scanCompletedAt: str | None = None


class ReviewEventItem(BaseModel):
    action: str
    reason: str
    notes: str | None = None
    reviewer: str
    createdAt: str
    digest: str
    signerFingerprint: str | None = None


class SecurityDiff(BaseModel):
    fields: list[SecurityDiffField]
    addedPermissions: list[str] = []
    removedPermissions: list[str] = []
    addedSecrets: list[str] = []
    removedSecrets: list[str] = []


class VersionIdentityDetail(BaseModel):
    identity: VersionIdentity
    manifest: dict[str, Any]
    securityDiff: SecurityDiff
    reviewHistory: list[ReviewEventItem] = []


class ActivityItem(BaseModel):
    action: str
    detail: dict[str, Any]
    createdAt: str


class PublisherActivity(BaseModel):
    items: list[ActivityItem]


class PublisherOverview(BaseModel):
    namespaceCount: int
    packageCount: int
    keyCount: int
    activeSessions: int
    publishesUsed: int
    publishesLimit: int
    publishesUnlimited: bool = False
    pendingScans: int
    flaggedVersions: int


class ReviewQueueItem(BaseModel):
    id: int
    namespace: str
    name: str
    version: str
    digest: str
    publishedAt: str
    publisher: str
    signerFingerprint: str | None = None
    reviewStatus: str
    securityStatus: str
    riskScore: int
    permissions: list[str] = []
    secrets: list[str] = []
    downloads: int


class ReviewQueueResponse(BaseModel):
    items: list[ReviewQueueItem]


def dt_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat().replace("+00:00", "Z")
