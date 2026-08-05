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
│   ├── identity/         users, GitHub OAuth, JWT, signing keys
│   ├── registry/         agents + versions, publish/search/download use cases
│   ├── security_review/  archive safety scan + per-version scan state (ports)
│   ├── organizations/    module boundary (authz lands in later milestones)
│   ├── entitlements/     module boundary (quotas/billing land later)
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
| `REGISTRY_OUTBOX_POLL_INTERVAL_SECONDS` | 1.0 | outbox dispatcher poll interval |

## API surface (see [api.md](api.md) for the contract)

- `GET /api/v1/agents` (+ search filters), `/agents/{ns}/{name}`,
  `/agents/{ns}/{name}/versions`, `/versions/{version}`,
  `/versions/{version}/archive`
- `PUT /agents/{ns}/{name}/versions/{version}` (publish, auth required)
- `POST /versions/{version}/scan` (re-scan)
- `POST /api/v1/auth/github` (OAuth code → JWT)
- `POST /api/v1/keys` (register signing key)
- `GET /api/v1/me` (current user)
- `GET /health` (liveness), `GET /ready` (dependency status), `GET /metrics`
  (counters), `GET /openapi.json` (contract; snapshot in `openapi/`)

## Security posture

- Re-verifies the Ed25519 signature on every publish (`app/crypto.py`,
  base64 — never hex).
- Static archive scan → `clean` / `flagged` security status stored with each
  version (`app/security_review/scanning.py`); publish enqueues an async
  `scan.requested` outbox event processed by the scan worker.
- Upload caps: archive bytes (413 beyond `REGISTRY_MAX_ARCHIVE_BYTES`) and
  signature file (1 MiB).
- Path-traversal guard in `ArchiveStore._safe_segment`.
- Module-boundary tests (`tests/test_architecture.py`) prevent routers from
  bypassing application use cases or mutating another module's tables.

See [storage.md](storage.md), [auth.md](auth.md), [api.md](api.md),
[security-scan.md](security-scan.md).
