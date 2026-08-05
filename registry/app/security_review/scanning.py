import io
import tarfile

import yaml


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
