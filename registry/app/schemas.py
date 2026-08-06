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


class VisibilityUpdateRequest(BaseModel):
    visibility: str
    organizationSlug: str | None = None


class GrantRequest(BaseModel):
    username: str | None = None
    teamId: int | None = None


class GrantResponse(BaseModel):
    username: str | None = None
    teamId: int | None = None
    agent: str


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


class OrgInfo(BaseModel):
    slug: str
    displayName: str
    status: str
    role: str


class OrganizationDetail(BaseModel):
    slug: str
    displayName: str
    status: str
    myRole: str
    memberCount: int


class OrgCreateRequest(BaseModel):
    slug: str
    displayName: str


class OrgUpdateRequest(BaseModel):
    displayName: str | None = None


class OrgMemberRequest(BaseModel):
    username: str
    role: str


class OrgRoleRequest(BaseModel):
    role: str


class OrgMemberItem(BaseModel):
    username: str
    role: str


class OrgMembersResponse(BaseModel):
    items: list[OrgMemberItem]


class OrgInvitationItem(BaseModel):
    id: int
    username: str
    role: str
    expiresAt: str
    accepted: bool


class OrgInvitationsResponse(BaseModel):
    items: list[OrgInvitationItem]


class OrgTeamItem(BaseModel):
    id: int
    name: str
    memberCount: int


class OrgTeamsResponse(BaseModel):
    items: list[OrgTeamItem]


class InviteRequest(BaseModel):
    username: str
    role: str


class TeamCreateRequest(BaseModel):
    name: str


class TeamMemberRequest(BaseModel):
    username: str


class InviteResponse(BaseModel):
    slug: str
    username: str
    role: str
    token: str
    expiresInHours: int


class AcceptInviteRequest(BaseModel):
    token: str


class OrgActionResponse(BaseModel):
    slug: str
    username: str | None = None
    role: str | None = None
    team: str | None = None


class ApiTokenInfo(BaseModel):
    id: int
    label: str
    prefix: str
    scopes: list[str]
    organizationId: int | None = None
    isServiceAccount: bool = False
    createdAt: str
    lastUsedAt: str | None = None
    expiresAt: str | None = None
    revoked: bool = False


class ApiTokenCreateRequest(BaseModel):
    label: str
    scopes: list[str] = ["packages:read", "packages:publish"]
    organizationId: int | None = None
    isServiceAccount: bool = False
    expiresInDays: int | None = None


class ApiTokenCreateResponse(BaseModel):
    id: int
    token: str
    prefix: str
    scopes: list[str]


class ApiTokensResponse(BaseModel):
    items: list[ApiTokenInfo]


class ApiTokenRotateRequest(BaseModel):
    expiresInDays: int | None = None


class ServiceAccountCreateRequest(BaseModel):
    name: str
    role: str = "maintainer"


class ServiceAccountTokenRequest(BaseModel):
    label: str
    scopes: list[str] = ["packages:read", "packages:publish"]
    expiresInDays: int | None = None


class ServiceAccountItem(BaseModel):
    id: int
    name: str
    username: str
    role: str
    status: str


class ServiceAccountsResponse(BaseModel):
    items: list[ServiceAccountItem]


class AuditEntry(BaseModel):
    id: int
    actorId: int | None = None
    actorUsername: str | None = None
    action: str
    targetType: str | None = None
    targetId: int | None = None
    namespace: str | None = None
    name: str | None = None
    detail: dict[str, Any] = {}
    createdAt: str

    @classmethod
    def from_event(cls, event) -> "AuditEntry":
        return cls(
            id=event.id,
            actorId=event.actor_id,
            action=event.action,
            targetType=event.target_type,
            targetId=event.target_id,
            namespace=event.namespace,
            name=event.name,
            detail=event.detail or {},
            createdAt=dt_iso(event.created_at),
        )


class AuditLogResponse(BaseModel):
    items: list[AuditEntry]
    nextCursor: int | None = None
    retentionDays: int | None = None
    oldestEventAt: str | None = None


class OrgQuotaUpdateRequest(BaseModel):
    limits: dict[str, int] | None = None
    ttlDays: int = 30


class OrgQuotaResponse(BaseModel):
    limits: dict[str, int]
    usage: dict[str, int]
    forecast: dict[str, int | None]
    resetDate: str
    overridesExpireAt: str | None = None


class BillingTransitionRequest(BaseModel):
    status: str
    reason: str | None = None


class BillingPlanRequest(BaseModel):
    plan: str


class BillingRetention(BaseModel):
    auditRetentionDays: int | None = None
    cancelRetentionDays: int | None = None


class OrgBillingResponse(BaseModel):
    plan: str
    planName: str
    status: str
    supportLevel: str
    entitlements: dict[str, int]
    limits: dict[str, int]
    usage: dict[str, int]
    forecast: dict[str, int | None]
    resetDate: str
    trialEndsAt: str | None = None
    graceEndsAt: str | None = None
    canceledAt: str | None = None
    retention: BillingRetention


class WebhookEventRequest(BaseModel):
    provider: str
    eventId: str
    eventType: str
    payload: dict[str, Any] = {}


class WebhookEventResponse(BaseModel):
    duplicate: bool
    eventId: str
    status: str | None = None


class BillingWebhookEventSummary(BaseModel):
    provider: str
    eventId: str
    eventType: str
    status: str
    receivedAt: str | None = None
    processedAt: str | None = None


class BillingWebhookListResponse(BaseModel):
    items: list[BillingWebhookEventSummary]


def dt_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat().replace("+00:00", "Z")
