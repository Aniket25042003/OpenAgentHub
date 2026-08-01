# Registry — FastAPI backend

`registry/` — a self-hostable package registry for agents. Python 3.11+,
FastAPI, async SQLAlchemy.

## Stack

- **FastAPI** + Uvicorn; Pydantic v2 (`pydantic-settings` for config).
- **DB**: SQLite (`sqlite+aiosqlite`) for dev/tests, **Postgres** in prod via
  `REGISTRY_DATABASE_URL`. Schema created at startup (`app/db.py` `init_db`).
  JSON columns map to JSONB on Postgres, JSON/Text on SQLite
  (`app/models.py` `JSONType`).
- **Storage**: archive blobs on the filesystem (`REGISTRY_STORAGE_DIR`), never
  in the DB (`app/store.py` `ArchiveStore`).
- **Auth**: JWT (HS256) + GitHub OAuth code exchange (`app/auth.py`).
- **Managed with uv**: `uv sync --extra dev`, `uv run pytest`,
  `uv run uvicorn app.main:app --port 8000`.

## Layout

```
registry/
├── app/
│   ├── main.py         create_app() factory, CORS, router wiring, /health
│   ├── config.py       Settings (env prefix REGISTRY_)
│   ├── db.py           async engine, session factory, init/dispose
│   ├── models.py       SQLAlchemy models (User, SigningKey, Agent, AgentVersion)
│   ├── schemas.py      Pydantic request/response schemas
│   ├── auth.py         JWT issue/decode, get_current_user, GitHub code exchange
│   ├── security.py     signature verification + static archive safety scan
│   ├── store.py        ArchiveStore (filesystem archive blobs)
│   └── routers/
│       ├── agents.py   /api/v1/agents...
│       ├── auth.py     POST /api/v1/auth/github
│       ├── keys.py     POST /api/v1/keys
│       └── me.py       GET /api/v1/me
└── tests/              pytest suite (19 tests)
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

## API surface (see [api.md](api.md) for the contract)

- `GET /api/v1/agents` (+ search filters), `/agents/{ns}/{name}`,
  `/agents/{ns}/{name}/versions`, `/versions/{version}`,
  `/versions/{version}/archive`
- `PUT /agents/{ns}/{name}/versions/{version}` (publish, auth required)
- `POST /versions/{version}/scan` (re-scan)
- `POST /api/v1/auth/github` (OAuth code → JWT)
- `POST /api/v1/keys` (register signing key)
- `GET /api/v1/me` (current user)

## Security posture

- Re-verifies the Ed25519 signature on every publish (`app/security.py`,
  base64 — never hex).
- Static archive scan → `clean` / `flagged` security status stored with each
  version (`check_archive_safety`).
- Upload caps: archive bytes (413 beyond `REGISTRY_MAX_ARCHIVE_BYTES`) and
  signature file (1 MiB).
- Path-traversal guard in `ArchiveStore._safe_segment`.

See [storage.md](storage.md), [auth.md](auth.md), [api.md](api.md),
[security-scan.md](security-scan.md).
