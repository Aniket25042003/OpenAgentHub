# ADR-0006 — Registry stack

**Status:** Accepted

## Context

We need a self-hostable registry: search, publish, auth, and archive storage
with a documented HTTP API that the TS SDK already implements. The choice of
stack should keep a single deployable service with minimal moving parts.

## Decision

- **Framework**: FastAPI (Python 3.11+), async SQLAlchemy, Pydantic v2 +
  `pydantic-settings`.
- **Database**: SQLite (`sqlite+aiosqlite`) for dev/tests, **Postgres** in
  prod, switched by `REGISTRY_DATABASE_URL` — no code changes needed.
- **Storage**: archive blobs on the filesystem
  (`REGISTRY_STORAGE_DIR`), never in the DB, with path-traversal guards and a
  uniform upload cap (`REGISTRY_MAX_ARCHIVE_BYTES`).
- **Auth**: JWT (HS256) + GitHub OAuth for identity; signing keys registered
  per user.
- **API**: `/api/v1/...`, matching the SDK's `registry.ts` contract exactly
  (`version=latest` alias, `AgentSummary`/`AgentVersionDetail` shapes).
- **Package management**: `uv` (sync, test with `uv run pytest`, serve with
  `uv run uvicorn app.main:app --port 8000`).

## Consequences

- One service to deploy; storage + DB are configurable paths/URLs.
- The default `REGISTRY_JWT_SECRET=change-me` triggers a startup warning —
  must be set before public deployment.
- API changes must be coordinated with `sdk/src/registry.ts`; tests exist on
  both sides.

## Alternatives considered

- Node/Express registry → would unify language but the SDK client already
  defines the contract; Python keeps the registry separate and typed.
- Postgres-only → poor dev experience without Docker.
