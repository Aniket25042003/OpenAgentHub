# ADR-0008: Modular monolith + independently deployed workers

Status: accepted (M-0.0)

## Context

The registry must grow into a hosted product (publishers, review, private
packages, billing) without falling into premature microservices. Clients (CLI,
SDK, hosted web) need one stable, versioned API contract, and hostile work
(scanning hostile archives) must not run in the request path.

## Decision

- **One hosted FastAPI modular monolith.** Domain modules live in-process:
  `identity`, `organizations` (authz), `registry` (packages), `security_review`,
  `entitlements` (quotas/billing), `audit`.
- **Independently deployed asynchronous workers** (scan, notifications, billing,
  maintenance) in one monorepo, deployed separately.
- **One PostgreSQL cluster** with module-owned tables and write paths. No
  per-module databases, no internal HTTP calls between modules.
- **Shared technical infrastructure behind adapters**: cache, durable queue,
  transactional outbox, object storage.
- **One versioned OpenAPI contract** (`registry/openapi/registry-openapi.json`)
  is the source of truth for CLI and web; CI fails on contract drift.
- Local development runs API + workers together (see `registry/scripts/dev.sh`).

## Module rules

1. Routers are thin: parse, validate, call one application use case, serialize.
2. Business rules live in domain/application modules, not routes or workers.
3. Modules own repositories for their tables; cross-module reads/writes use
   explicit application interfaces or ports (e.g. `security_review.ScanStore`).
4. Shared utilities are limited to technical concerns (db, config, crypto,
   store, telemetry, schemas).
5. Core synchronous transitions use one PostgreSQL transaction; expensive or
   external work is enqueued via the transactional outbox after commit.
6. Workers are idempotent, retryable, and safe against duplicate delivery;
   queues have bounded retries, backoff, and dead-lettering.

## Enforcement

Import-boundary tests in `registry/tests/test_architecture.py` fail when a
router imports models or SQLAlchemy, a module imports another module's routes,
or a cross-module import is not on the explicit allowlist.

## Consequences

- Worker entrypoints: `python -m app.workers.scan` (and notifications, billing,
  maintenance) — each claims lease-based jobs from the shared `queue_jobs`
  table via `DurableQueue`.
- Outbox: `outbox_events` written in the same transaction as domain state;
  `OutboxDispatcher` (in-process background task) publishes to the queue.
- Extraction to network microservices later must satisfy the criteria in
  `plans/architecture.md`.
