# Registry — FastAPI backend

`registry/` — a self-hostable package registry for agents. Python 3.11+,
FastAPI, async SQLAlchemy. Modular monolith + independently deployed workers
(see [ADR-0008](../decisions/ADR-0008-modular-monolith-and-workers.md)).

## Stack

- **FastAPI** + Uvicorn; Pydantic v2 (`pydantic-settings` for config).
- **DB**: SQLite (`sqlite+aiosqlite`) for dev/tests, **Postgres** in prod via
  `REGISTRY_DATABASE_URL`. Schema created at startup (`app/db.py` `init_db`).
  JSON columns map to JSONB on Postgres, JSON/Text on SQLite (`app/db.py`
  `JSONType`).
- **Storage**: archive blobs on the filesystem (`REGISTRY_STORAGE_DIR`), never
  in the DB (`app/store.py` `ArchiveStore`).
- **Auth**: JWT (HS256) + GitHub OAuth code exchange (`app/identity/`).
- **Outbox + durable queue**: `app/outbox/` — domain state and outbox records
  commit in one transaction; `OutboxDispatcher` publishes events to the
  `queue_jobs` table; workers claim lease-based jobs with retry/backoff and
  dead-lettering.
- **Workers**: `python -m app.workers.scan|notifications|billing|maintenance`
  (see [ADR-0008](../decisions/ADR-0008-modular-monolith-and-workers.md)).
- **Managed with uv**: `uv sync --extra dev`, `uv run pytest`,
  `uv run uvicorn app.main:app --port 8000`. One-command local dev:
  `scripts/dev.sh` (API + all workers).

## Layout

```
registry/
├── app/
│   ├── main.py           create_app() factory, lifespan, /health /ready /metrics
│   ├── config.py         Settings (env prefix REGISTRY_)
│   ├── db.py             async engine, session factory, init/dispose/reset
│   ├── crypto.py         Ed25519 signature verification, fingerprints, sha256
│   ├── store.py          ArchiveStore (filesystem archive blobs)
│   ├── telemetry.py      request IDs, structured logging, metrics
│   ├── schemas.py        Pydantic request/response schemas (API contract)
│   ├── identity/         users (roles/status), GitHub OAuth, JWT, signing-key lifecycle
│   ├── registry/         agents + versions, namespaces + ACL, publish/search/download use cases
│   ├── security_review/  canonical manifest schema + archive safety scan (ports)
│   ├── organizations/    orgs, roles, teams, invitations, service accounts, audit-log APIs
│   ├── entitlements/     publish quotas + rate limits (billing lands later)
│   ├── quotas/           org storage/download/member quotas, overrides with expiry
│   ├── billing/          plans + entitlements, subscription lifecycle, idempotent webhooks, usage export
│   ├── audit/            append-only audit events
│   ├── outbox/           outbox events, durable queue, dispatcher, worker base
│   └── workers/          scan / notifications / billing / maintenance entrypoints
├── scripts/
│   ├── dev.sh            one-command local dev (API + workers)
│   └── export_openapi.py publish openapi/registry-openapi.json (CI drift check)
├── openapi/
│   └── registry-openapi.json   committed OpenAPI contract snapshot
└── tests/                pytest suite (API, auth, outbox, telemetry, boundaries)
```

## Configuration (env, prefix `REGISTRY_`)

| Env var | Default | Purpose |
| --- | --- | --- |
| `REGISTRY_DATABASE_URL` | `sqlite+aiosqlite:///./registry.db` | SQLite dev / Postgres prod |
| `REGISTRY_STORAGE_DIR` | `./storage` | archive blob store |
| `REGISTRY_JWT_SECRET` | `change-me` | **must be changed** in prod; startup warns |
| `REGISTRY_JWT_ALGORITHM` | `HS256` | JWT algorithm |
| `REGISTRY_TOKEN_TTL_SECONDS` | 7d | JWT lifetime |
| `REGISTRY_GITHUB_CLIENT_ID` / `..._SECRET` | "" | GitHub OAuth app |
| `REGISTRY_GITHUB_TOKEN_URL` / `..._USER_URL` | GitHub defaults | OAuth endpoints |
| `REGISTRY_PUBLIC_BASE_URL` | `http://localhost:8000` | public-facing links |
| `REGISTRY_CORS_ORIGINS` | `*` | comma-separated or `*` |
| `REGISTRY_MAX_ARCHIVE_BYTES` | 250 MiB | upload cap (archive + scan) |
| `REGISTRY_MAX_ARCHIVE_UNCOMPRESSED_BYTES` | 512 MiB | scan cap on uncompressed total |
| `REGISTRY_MAX_ARCHIVE_ENTRIES` | 10 000 | scan cap on member count |
| `REGISTRY_PUBLISH_QUOTA_NEW_ACCOUNT_DAILY` | 10 | daily publishes for accounts < `..._DAYS` old |
| `REGISTRY_PUBLISH_QUOTA_NEW_ACCOUNT_DAYS` | 7 | account age for the new-account quota |
| `REGISTRY_PUBLISH_PER_IP_PER_HOUR` | 120 | in-memory per-IP publish throttle |
| `REGISTRY_RESERVED_NAMESPACE_PREFIXES` | `openagenthub-,oah-,github-,...` | reserved namespace names |
| `REGISTRY_OUTBOX_POLL_INTERVAL_SECONDS` | 1.0 | outbox dispatcher poll interval |
| `REGISTRY_ORG_QUOTA_DEFAULT_*` | 100/500/5GiB/100GiB/25/10 | free-plan quota defaults (packages/versions/storage/bandwidth/members/service accounts) |
| `REGISTRY_ORG_AUDIT_RETENTION_DEFAULT_DAYS` | 90 | audit-log retention for the free plan |
| `REGISTRY_BILLING_TRIAL_DAYS` | 14 | trial duration before expiry |
| `REGISTRY_BILLING_GRACE_DAYS` | 7 | grace window after a payment failure |
| `REGISTRY_BILLING_PAST_DUE_DAYS` | 14 | past-due window before suspension |
| `REGISTRY_BILLING_CANCEL_RETENTION_DAYS` | 30 | artifacts retained after cancellation (never destroyed by transitions) |
| `REGISTRY_BILLING_WEBHOOK_SECRET` | "" | when set, `POST .../billing/webhooks` requires `X-OpenAgentHub-Signature` (HMAC-SHA256) |
| `REGISTRY_BILLING_LAUNCHABLE_PLANS` | `free` | comma-separated plans switchable via the plan endpoint |

## API surface (see [api.md](api.md) for the contract)

- `GET /api/v1/agents` (+ search filters), `/agents/{ns}/{name}`,
  `/agents/{ns}/{name}/versions` (semver desc), `/versions/{version}`
  (`latest` = highest semver, not newest publish), `/versions/{version}/archive`
- `PUT /agents/{ns}/{name}/versions/{version}` (publish, auth required;
  signature key must be registered + active, namespace must be owned)
- `POST /versions/{version}/scan` (re-scan, auth required, cooldown-throttled)
- `GET /api/v1/revocations` (public revocation/quarantine feed)
- `POST /api/v1/admin/agents/.../review` (reviewer/admin: verify|warning|reject|revoke with reason; see [review.md](review.md))
- `POST /api/v1/namespaces`, `/namespaces/{ns}/maintainers` (claim + ACL)
- `POST /api/v1/admin/users/{id}/suspend`, `/admin/agents/.../yank`
  (admin/reviewer controls)
- `POST /api/v1/auth/github` (OAuth code → JWT)
- `POST /api/v1/keys`, `DELETE /api/v1/keys/{id}` (register/revoke signing key)
- `GET /api/v1/me` (current user, keys, role/status)
- `GET /api/v1/orgs/{slug}/quota`, `PUT /api/v1/orgs/{slug}/quota` (usage snapshot + owner/admin overrides with TTL)
- `GET /api/v1/orgs/{slug}/billing` (plan, status, entitlements, usage, retention),
  `POST /orgs/{slug}/billing/transitions` (owner/admin/billing_manager lifecycle control),
  `PUT /orgs/{slug}/billing/plan`, `GET /orgs/{slug}/billing/usage-export` (CSV),
  `POST /orgs/{slug}/billing/webhooks` (idempotent, HMAC-signed provider events)
- `GET /health` (liveness), `GET /ready` (dependency status), `GET /metrics`
  (counters), `GET /openapi.json` (contract; snapshot in `openapi/`)

## Security posture

- Re-verifies the Ed25519 signature on every publish (`app/crypto.py`,
  base64 — never hex); the signer key must be registered to the publisher and
  active (not revoked/expired).
- Namespaces are bound to a single owning account with an explicit maintainer
  ACL; cross-account publishes are rejected with 403.
- Manifests are validated against the canonical `agent.schema.json` before any
  DB write (byte-identical to `specs/`; CI checks drift).
- Static archive scan → `clean` / `flagged` security status stored with each
  version (`app/security_review/scanning.py`); publish enqueues an async
  `scan.requested` outbox event processed by the scan worker.
- New-account publish quotas (audit-enforced) + per-IP publish throttle (429
  with `Retry-After`).
- Organization quotas (`app/quotas/`): package/version/storage counts,
  monthly download bandwidth, members, and service accounts, enforced
  transactionally inside the publish/download/member flows. Administrator
  overrides (`GET/PUT /api/v1/orgs/{slug}/quota`) are bounded by an expiry and
  audited (`organization.quota.override_set`). Pre-existing databases are
  migrated with `archive_bytes` populated on publish.
- Upload caps: archive bytes (413 beyond `REGISTRY_MAX_ARCHIVE_BYTES`) and
  signature file (1 MiB).
- Path-traversal guard in `ArchiveStore._safe_segment`.
- Module-boundary tests (`tests/test_architecture.py`) prevent routers from
  bypassing application use cases or mutating another module's tables.

See [storage.md](storage.md), [auth.md](auth.md), [api.md](api.md),
[security-scan.md](security-scan.md).
