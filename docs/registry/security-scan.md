# Registry — Security scanning

`app/security_review/scanning.py`

Every published archive passes through three checks.

## Stage 1 — Signature verification (on publish)

`verify_signature(sig: SignatureFile, archive: bytes)` raises `SignatureError`
unless:

- `sig.schemaVersion == 1` and `sig.algorithm == "ed25519"`;
- sha256 of the archive bytes equals `sig.sha256`;
- `sig.publicKeyId` equals the fingerprint of the embedded `sig.publicKey`;
- the Ed25519 signature verifies over
  `openagenthub-signature-v1:<name>@<version>:<sha256>`,
  where the signature is decoded with **`base64.b64decode`** (never hex).

Publish additionally requires the signature's `publicKeyId` to match an
**active signing key registered to the authenticated publisher** (not revoked,
not expired, owned by the same account) — see
[`docs/registry/auth.md`](auth.md). The router also checks `sig.name`/
`sig.version` match the publish route and that the manifest extracted from the
archive matches the signature.

## Stage 2 — Canonical manifest validation (on publish)

`validate_manifest_schema(manifest)` validates the extracted manifest against
the canonical `agent.schema.json` (the registry copy lives at
`app/security_review/agent.schema.json` and must stay byte-identical to
`specs/agent.schema.json`; CI enforces this). Invalid manifests are rejected
before any database write. This enforces, among other rules, the
`permissions` array shape and the `"none"`-exclusivity rule.

## Stage 3 — Static archive scan (`check_archive_safety`)

Runs synchronously at publish and again on `POST .../scan` (authenticated,
throttled by `REGISTRY_RESCAN_COOLDOWN_SECONDS`). Returns a list of findings;
an empty list → `clean`, otherwise `flagged`. The `scan_requested_at` /
`scan_completed_at` timestamps track each scan.

Findings are produced when:

- the archive exceeds `max_bytes` (`REGISTRY_MAX_ARCHIVE_BYTES`);
- it isn't a valid gzip tar (`tarfile.TarError`);
- any member is a symlink or hardlink;
- any member is a device node;
- any member has an absolute path, a `..` path segment, a drive-letter path,
  or a NUL byte;
- any member is larger than 100 MiB;
- the aggregate uncompressed size exceeds
  `REGISTRY_MAX_ARCHIVE_UNCOMPRESSED_BYTES` (512 MiB default);
- the member count exceeds `REGISTRY_MAX_ARCHIVE_ENTRIES` (10 000 default);
- the archive does not contain exactly one `agent.yaml` at the root
  (nested, duplicate, or `agent.yml`-named manifests are findings).

## Manifest extraction (`manifest_from_archive`)

Reads only the single regular member named exactly `agent.yaml` at the archive
root; anything else (nested `agent.yaml`, `agent.yml`, duplicates, AppleDouble
`._agent.yaml` variants) is rejected.

## How status is used

- Stored per version (`security_status`, `security_findings`) and exposed in
  `AgentVersionDetail.security`.
- `trust` in summaries/details is derived: `flagged` → `"untrusted"`, else
  `"unknown"`.
- The CLI installer maps `flagged` → `untrusted` → container sandbox, and the
  website + `agent info`-style surfaces display the findings.
- `flagged` versions are **quarantined**: archive download returns 403 and the
  public revocation feed (`GET /api/v1/revocations`) lists them, alongside
  `rejected`/`revoked` review statuses (see [review.md](review.md)).

## What the scanner does NOT do (yet)

The static scan is structural only: archive format, member types, paths,
sizes, and manifest schema. It does **not** scan for secrets, licenses,
dependency vulnerabilities, or malicious code content. Do not claim otherwise
in docs or UI until those scans exist.

## Defense in depth

The scan is a *signal*, not the only boundary. The client re-checks at
install: sha256, Ed25519 signature, and strict unpacking (traversal/symlink/
size caps) — see [packaging](../architecture/packaging.md).
