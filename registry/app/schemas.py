from datetime import datetime
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


class SearchResponse(BaseModel):
    items: list[AgentSummary]


class VersionsResponse(BaseModel):
    versions: list[str]


class MeResponse(BaseModel):
    username: str
    publicKeys: list[dict[str, str]]


class UploadKeyRequest(BaseModel):
    publicKey: str


class GithubExchangeRequest(BaseModel):
    code: str


class GithubExchangeResponse(BaseModel):
    token: str
    username: str


def dt_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat().replace("+00:00", "Z")
