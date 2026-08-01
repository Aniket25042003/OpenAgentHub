import base64
import hashlib
import io
import tarfile

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def public_key_fingerprint(pem: str) -> str:
    pub = serialization.load_pem_public_key(pem.encode("utf-8"))
    der = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()[:16]


def make_keypair():
    key = Ed25519PrivateKey.generate()
    priv = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    pub = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return key, priv, pub


def signature_payload(name: str, version: str, sha256: str) -> str:
    return f"openagenthub-signature-v1:{name}@{version}:{sha256}"


def make_archive(
    name: str,
    version: str,
    manifest: dict,
    files: dict[str, str],
    key: Ed25519PrivateKey,
    pub: str,
) -> tuple[bytes, dict]:
    """Build an .ahb-style gzip tar + matching SignatureFile dict (mirrors SDK packAgent)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path, content in files.items():
            data = content.encode("utf-8")
            info = tarfile.TarInfo(path)
            info.size = len(data)
            info.mode = 0o644
            tf.addfile(info, io.BytesIO(data))
    archive = buf.getvalue()

    sha = sha256_hex(archive)
    payload = signature_payload(name, version, sha).encode()
    sig_hex = base64.b64encode(key.sign(payload)).decode()
    sig = {
        "schemaVersion": 1,
        "name": name,
        "version": version,
        "algorithm": "ed25519",
        "publicKey": pub,
        "publicKeyId": public_key_fingerprint(pub),
        "sha256": sha,
        "signature": sig_hex,
    }
    return archive, sig


def hello_manifest(name: str, version: str, **overrides) -> dict:
    m = {
        "manifestVersion": 1,
        "name": name,
        "version": version,
        "author": "tester",
        "description": "a test agent",
        "license": "MIT",
        "runtime": {"language": "python"},
        "models": {"supported": ["local"]},
        "permissions": {"network": False, "filesystem": False},
        "interfaces": {"cli": {"command": "python app.py"}},
        "tags": ["demo"],
    }
    m.update(overrides)
    return m
