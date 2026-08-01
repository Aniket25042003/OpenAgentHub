import base64
import hashlib
import io
import tarfile

import yaml
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.schemas import SignatureFile


class SignatureError(ValueError):
    pass


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def signature_payload(name: str, version: str, sha256: str) -> str:
    return f"openagenthub-signature-v1:{name}@{version}:{sha256}"


def load_ed25519_public_key(pem: str) -> Ed25519PublicKey:
    try:
        return serialization.load_pem_public_key(pem.encode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - surface all key parsing failures
        raise SignatureError(f"invalid public key PEM: {exc}") from exc


def public_key_fingerprint(pem: str) -> str:
    pub = load_ed25519_public_key(pem)
    der = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()[:16]


def verify_signature(sig: SignatureFile, archive: bytes) -> None:
    """Verify a package signature against the archive bytes. Raises SignatureError."""
    if sig.schemaVersion != 1 or sig.algorithm != "ed25519":
        raise SignatureError("unsupported signature schema/algorithm")
    actual = sha256_hex(archive)
    if actual != sig.sha256:
        raise SignatureError(f"sha256 mismatch: archive is {actual}, signature says {sig.sha256}")
    pub = load_ed25519_public_key(sig.publicKey)
    try:
        pub.verify(base64.b64decode(sig.signature), signature_payload(sig.name, sig.version, sig.sha256).encode("utf-8"))
    except (InvalidSignature, ValueError) as exc:
        raise SignatureError("ed25519 signature does not verify") from exc


def _is_safe_member(member: tarfile.TarInfo) -> str | None:
    """Return a rejection reason if a tar member is unsafe, else None."""
    if member.issym() or member.islnk():
        return "archive must not contain symlinks or hardlinks"
    if member.isdev():
        return "archive must not contain device nodes"
    name = member.name
    if name.startswith("/") or ".." in name.split("/"):
        return f"unsafe path in archive: {name}"
    if "\x00" in name:
        return "path contains NUL byte"
    if member.size > 100 * 1024 * 1024:
        return f"member too large: {name}"
    return None


def check_archive_safety(archive: bytes, max_bytes: int) -> list[str]:
    """Static safety scan of a package archive. Returns a list of findings (empty = clean)."""
    findings: list[str] = []
    if len(archive) > max_bytes:
        return [f"archive exceeds {max_bytes} bytes"]
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tf:
            names: list[str] = []
            for member in tf.getmembers():
                reason = _is_safe_member(member)
                if reason:
                    findings.append(reason)
                else:
                    names.append(member.name)
            if not any(p in ("agent.yaml", "agent.yml") for p in names):
                findings.append("archive missing agent.yaml")
    except tarfile.TarError as exc:
        return [f"invalid gzip tar archive: {exc}"]
    return findings


def manifest_from_archive(archive: bytes) -> dict:
    """Extract only safe regular members and return the parsed agent.yaml."""
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tf:
        for member in tf.getmembers():
            if not member.isreg():
                continue
            if member.name.split("/")[-1] not in ("agent.yaml", "agent.yml"):
                continue
            fobj = tf.extractfile(member)
            if fobj is None:
                continue
            try:
                return yaml.safe_load(fobj.read().decode("utf-8"))
            except yaml.YAMLError as exc:
                raise ValueError(f"invalid YAML in {member.name}: {exc}") from exc
    raise ValueError("archive missing agent.yaml")
