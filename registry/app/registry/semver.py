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


def semver_key(version: str) -> tuple[list[tuple[int, int | str]], tuple[int, str]]:
    pre = version.split("-", 1)[1] if "-" in version else None
    if pre is None:
        return (_parts(version), (1, ""))
    return (_parts(version), (0, pre))
