import base64
import hashlib

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
