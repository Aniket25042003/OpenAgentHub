import io
import json
import re
import tarfile
from functools import lru_cache
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

from app.config import get_settings

_SCHEMA_PATH = Path(__file__).resolve().parent / "agent.schema.json"

MANIFEST_FILENAME = "agent.yaml"


@lru_cache(maxsize=1)
def _manifest_validator() -> Draft202012Validator:
    schema = json.loads(_SCHEMA_PATH.read_text())
    return Draft202012Validator(schema)


def validate_manifest_schema(manifest: dict) -> None:
    """Validate a manifest against the canonical agent.schema.json. Raises ValueError."""
    errors = sorted(_manifest_validator().iter_errors(manifest), key=lambda e: list(e.path))
    if errors:
        first = errors[0]
        location = "/".join(str(p) for p in first.path) or "$"
        raise ValueError(f"manifest invalid at {location}: {first.message}")


def _is_safe_member(member: tarfile.TarInfo) -> str | None:
    """Return a rejection reason if a tar member is unsafe, else None."""
    if member.issym() or member.islnk():
        return "archive must not contain symlinks or hardlinks"
    if member.isdev():
        return "archive must not contain device nodes"
    name = member.name
    if name.startswith("/") or ".." in name.split("/"):
        return f"unsafe path in archive: {name}"
    if re.match(r"^[a-zA-Z]:", name):
        return f"unsafe path in archive: {name}"
    if "\x00" in name:
        return "path contains NUL byte"
    if member.size > 100 * 1024 * 1024:
        return f"member too large: {name}"
    return None


def check_archive_safety(
    archive: bytes,
    max_bytes: int,
    max_uncompressed_bytes: int | None = None,
    max_entries: int | None = None,
) -> list[str]:
    """Static safety scan of a package archive. Returns a list of findings (empty = clean)."""
    settings = get_settings()
    max_uncompressed_bytes = max_uncompressed_bytes or settings.max_archive_uncompressed_bytes
    max_entries = max_entries or settings.max_archive_entries
    findings: list[str] = []
    if len(archive) > max_bytes:
        return [f"archive exceeds {max_bytes} bytes"]
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tf:
            members = tf.getmembers()
            if len(members) > max_entries:
                findings.append(f"archive has more than {max_entries} entries")
            total = 0
            manifest_paths: list[str] = []
            for member in members:
                reason = _is_safe_member(member)
                if reason:
                    findings.append(reason)
                    continue
                total += member.size
                if member.name.split("/")[-1] in (MANIFEST_FILENAME, "agent.yml"):
                    manifest_paths.append(member.name)
            if total > max_uncompressed_bytes:
                findings.append(f"archive uncompressed size exceeds {max_uncompressed_bytes} bytes")
            if len(manifest_paths) == 0:
                findings.append("archive missing agent.yaml")
            elif manifest_paths != [MANIFEST_FILENAME]:
                findings.append(f"archive must contain exactly one {MANIFEST_FILENAME} at the root")
    except tarfile.TarError as exc:
        return [f"invalid gzip tar archive: {exc}"]
    return findings


def manifest_from_archive(archive: bytes) -> dict:
    """Extract only safe regular members and return the parsed root agent.yaml."""
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tf:
        candidates: list[str] = []
        for member in tf.getmembers():
            if not member.isreg():
                continue
            if member.name.split("/")[-1] in (MANIFEST_FILENAME, "agent.yml"):
                candidates.append(member.name)
        if candidates != [MANIFEST_FILENAME]:
            raise ValueError(f"archive must contain exactly one {MANIFEST_FILENAME} at the root")
        fobj = tf.extractfile(MANIFEST_FILENAME)
        if fobj is None:
            raise ValueError(f"archive missing {MANIFEST_FILENAME}")
        try:
            return yaml.safe_load(fobj.read().decode("utf-8"))
        except yaml.YAMLError as exc:
            raise ValueError(f"invalid YAML in {MANIFEST_FILENAME}: {exc}") from exc
