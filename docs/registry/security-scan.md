# Registry — Security scanning

`app/security_review/scanning.py`

Every published archive passes through two checks.

## Stage 1 — Signature verification (on publish)

`verify_signature(sig: SignatureFile, archive: bytes)` raises `SignatureError`
unless:

- `sig.schemaVersion == 1` and `sig.algorithm == "ed25519"`;
- sha256 of the archive bytes equals `sig.sha256`;
- the Ed25519 signature verifies over
  `openagenthub-signature-v1:<name>@<version>:<sha256>`,
  where the signature is decoded with **`base64.b64decode`** (never hex).

The router also checks `sig.name`/`sig.version` match the publish route and
that the manifest extracted from the archive matches the signature.

## Stage 2 — Static archive scan (`check_archive_safety`)

Runs at publish and again on `POST .../scan`. Returns a list of findings; an
empty list → `clean`, otherwise `flagged`.

Findings are produced when:

- the archive exceeds `max_bytes` (`REGISTRY_MAX_ARCHIVE_BYTES`);
- it isn't a valid gzip tar (`tarfile.TarError`);
- any member is a symlink or hardlink;
- any member is a device node;
- any member has an absolute path, a `..` path segment, or a NUL byte;
- any member is larger than 100 MiB;
- the archive has no `agent.yaml`/`agent.yml` at any level (basename check).

## Manifest extraction (`manifest_from_archive`)

Reads only regular-file members whose **basename** (last path segment) is
`agent.yaml` or `agent.yml`. Because it splits on `/`, an AppleDouble
`._agent.yaml` does **not** match — this was the bug that broke publishing on
macOS-built archives.

## How status is used

- Stored per version (`security_status`, `security_findings`) and exposed in
  `AgentVersionDetail.security`.
- `trust` in summaries/details is derived: `flagged` → `"untrusted"`, else
  `"unknown"`.
- The CLI installer maps `flagged` → `untrusted` → container sandbox, and the
  website + `agent info`-style surfaces display the findings.

## Defense in depth

The scan is a *signal*, not the only boundary. The client re-checks at
install: sha256, Ed25519 signature, and strict unpacking (traversal/symlink/
size caps) — see [packaging](../architecture/packaging.md).
