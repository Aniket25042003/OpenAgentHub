# Registry — API contract

Versioned under `/api/v1`. This is the wire contract the SDK client
(`sdk/src/registry.ts`) implements. **Keep both in lockstep.**

## Agents

### `GET /api/v1/agents`

Search/list. Query params: `q`, `framework`, `tags` (comma-separated),
`models` (comma-separated), `sort` (`downloads`|`trending`|`newest`),
`limit` (1–100, default 50), `offset`.

Returns `{ items: AgentSummary[] }`. `AgentSummary`:

```json
{
  "namespace": "acme",
  "name": "pr-reviewer",
  "version": "1.2.0",
  "author": "acme",
  "description": "...",
  "license": "MIT",
  "framework": "openagenthub",
  "models": ["openai", "anthropic"],
  "tags": ["devtools"],
  "downloads": 12,
  "trust": "unknown"
}
```

### `GET /api/v1/agents/{namespace}/{name}`

Latest-version summary. 404 if not found (or no published versions).

### `GET /api/v1/agents/{namespace}/{name}/versions`

`{ "versions": ["1.2.0", "1.1.0"] }` — newest first.

### `GET /api/v1/agents/{namespace}/{name}/versions/{version}`

Version detail. `version=latest` resolves the highest published version
(ordered by `published_at`). Returns `AgentVersionDetail`:

```json
{
  "name": "acme/pr-reviewer",
  "version": "1.2.0",
  "author": "acme",
  "description": "...",
  "manifest": { "...": "the full agent.yaml as JSON" },
  "publishedAt": "2026-07-30T12:00:00Z",
  "downloadCount": 12,
  "trust": "unknown",
  "signature": {
    "schemaVersion": 1,
    "name": "acme/pr-reviewer",
    "version": "1.2.0",
    "algorithm": "ed25519",
    "publicKey": "<PEM>",
    "publicKeyId": "<16-hex>",
    "sha256": "<hex>",
    "signature": "<base64>"
  },
  "security": { "status": "clean", "findings": [] }
}
```

### `GET /api/v1/agents/{namespace}/{name}/versions/{version}/archive`

Binary `.ahb` download (`application/octet-stream`, `X-Content-Type-Options:
nosniff`). Increments `download_count`. Client-side sha256 check happens at
install (via the version detail's signature).

### `PUT /api/v1/agents/{namespace}/{name}/versions/{version}`

**Publish** (bearer JWT required). `multipart/form-data` with two file parts:

- `archive` — the `.ahb` file
- `signature` — JSON of the `SignatureFile` object

Server flow:

1. Size-check both parts (archive > `REGISTRY_MAX_ARCHIVE_BYTES` → 413;
   signature > 1 MiB → 413).
2. `verify_signature(sig, archive)` — recomputes
   `openagenthub-signature-v1:<name>@<version>:<sha256>`, checks sha256 and
   the Ed25519 signature (base64 decode) → 422 on failure.
3. `sig.name` must equal `namespace/name` and `sig.version` must equal the
   route version → 422 otherwise.
4. `check_archive_safety(archive)` → `security_status = "flagged"` if any
   findings, else `"clean"`.
5. Extract the manifest from the archive; `manifest.name`/`manifest.version`
   must match the signature → 422 otherwise.
6. Upsert the `Agent` row (extracting `framework.name` from the manifest
   object), reject duplicate version with 409, store the archive, insert the
   `AgentVersion`.
7. Returns `{ "ok": true, "security": "clean"|"flagged", "findings": [...] }`.

### `POST /api/v1/agents/{namespace}/{name}/versions/{version}/scan`

Re-runs the static scan and updates `security_status`/`security_findings`.
Returns `{ "status", "findings" }`.

## Auth & identity

### `POST /api/v1/auth/github`

Body: `{ "code": "..." }` (OAuth authorization code). Exchanges with GitHub,
looks up/creates the user, returns `{ "token": "<jwt>", "username": "..." }`.
Returns 503 if `REGISTRY_GITHUB_CLIENT_ID/SECRET` are not configured.

### `POST /api/v1/keys`

Body: `{ "publicKey": "<PEM SPKI>" }`. Validates it's an Ed25519 key, computes
the fingerprint, and registers it (idempotent). Returns
`{ "ok": true, "fingerprint": "...", "id": N }`.

### `GET /api/v1/me`

`{ "username": "...", "publicKeys": [{ "id": "..." }] }`. Requires auth.

## Health

`GET /health` → `{ "status": "ok" }` (used by the e2e harness).

## Errors

Standard FastAPI: `{ "detail": "..." }`. Codes: 400 (bad signature file,
bad key PEM, store error), 401 (missing/invalid/expired token), 404 (agent /
version / archive not found), 409 (version already published), 413 (archive
or signature too large), 422 (signature/manifest mismatch or invalid archive),
503 (GitHub OAuth not configured).

## Conventions

- `version=latest` alias implemented server-side.
- `trust` is always `"unknown"` unless the archive is `flagged`, in which case
  it's `"untrusted"`. There is no server-side "trusted" — that's a local
  install decision.
- Timestamps are ISO-8601 with a `Z` suffix (`dt_iso`).
