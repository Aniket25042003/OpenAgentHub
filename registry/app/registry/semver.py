"""Semantic-version ordering for registry version resolution.

Handles the common cases: numeric dot-separated cores, alphanumeric segments,
and a trailing pre-release label. Non-prerelease versions sort after
prereleases with the same core. This is intentionally simpler than full semver:
no build metadata handling, and equality between e.g. "1.0" and "1.0.0" is not
attempted (both sort stably by their string form).
"""


def _parts(version: str) -> list[tuple[int, int | str]]:
    core = version.split("-", 1)[0]
    parts: list[tuple[int, int | str]] = []
    for p in core.split("."):
        if p.isdigit():
            parts.append((0, int(p)))
        else:
            parts.append((1, p))
    return parts


def _pre_parts(pre: str) -> list[tuple[int, int | str]]:
    parts: list[tuple[int, int | str]] = []
    for p in pre.split("."):
        if p.isdigit():
            parts.append((0, int(p)))
        else:
            parts.append((1, p))
    return parts


def semver_key(version: str) -> tuple[list[tuple[int, int | str]], tuple[int, list[tuple[int, int | str]]]]:
    pre = version.split("-", 1)[1] if "-" in version else None
    if pre is None:
        return (_parts(version), (1, []))
    return (_parts(version), (0, _pre_parts(pre)))


def sort_key(version: str) -> str:
    """Collateable string that orders identically to :func:`semver_key`.

    Numeric segments are zero-padded so lexical string comparison matches
    numeric ordering; prerelease versions sort before the release of the same
    core. Used for the SQL ``sort_key`` column so latest-per-agent queries can
    run inside the database instead of loading every version into Python.
    """
    core = version.split("-", 1)[0]
    parts: list[str] = []
    for p in core.split("."):
        if p.isdigit():
            parts.append(f"n{int(p):012d}")
        else:
            parts.append(f"s{p}")
    pre = version.split("-", 1)[1] if "-" in version else None
    pre_tag = "1" if pre is None else "0" + _pre_sort_key(pre)
    return "".join(parts) + "#" + pre_tag


def _pre_sort_key(pre: str) -> str:
    segments: list[str] = []
    for p in pre.split("."):
        if p.isdigit():
            segments.append(f"n{int(p):012d}")
        else:
            segments.append(f"s{p}")
    return ".".join(segments)
