# M-6 — Registry scale, catalog, caching, and abuse protection

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-0 complete (can proceed in parallel with M-1–M-5 once M-0 lands). Resolve open decision #5 (Redis/object storage).
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `registry/`, `marketing/`, `sdk/src/registry.ts`.

## Suggested branches / PRs

- `feat/registry-catalog-hardening` — M-6

## Implementation plan

Architecture alignment:

- Search and catalog remain modules/read models inside the hosted API.
- Scaling begins with SQL optimization, indexes, shared cache, CDN, and read replicas,
  not a separate catalog microservice.
- Catalog refresh, count aggregation, and cleanup run as independently deployed
  maintenance workers through the outbox/queue.
- A future search service is considered only after measured query/indexing needs and
  must consume versioned events rather than share mutable registry tables.

### M-6.1 Efficient registry queries

1. Replace Python-side loading of every version with a database query that selects
   the latest visible version per agent.
2. Add indexes for namespace/name, publication time, visibility, review status,
   scan status, tags, framework, and supported models where query patterns require.
3. Add cursor pagination; do not return an unbounded all-agent payload.
4. Reuse one latest-version query implementation for search and catalog.
5. Add query-count and representative performance tests.

### M-6.2 Versioned catalog endpoint

1. Add `GET /api/v1/catalog` with cursor pagination and stable schema version.
2. Include:
   - namespace/name/version/digest;
   - publisher identity and verification;
   - review, scan, yank, and revocation status;
   - description, framework, models, runtime, interfaces, permissions, secret names,
     license, and tags;
   - publication and review timestamps.
3. Add filtering by text, runtime, model, framework, permission, publisher status,
   and review status.
4. Add `ETag`, `If-None-Match`, `Cache-Control`, and last-modified support.
5. Invalidate catalog metadata only after a successful database transaction.

### M-6.3 Cache and availability

1. Use in-process caching only for local development.
2. Use shared cache storage for multi-instance production.
3. Prevent cache stampedes with single-flight refresh or distributed locks.
4. Keep a last-known-good catalog payload with explicit stale headers.
5. Test database-down behavior, cache failure, cold start, and publish invalidation.
6. Never serve revoked data as trusted merely because a cache is stale; revocation
   has shorter cache duration and a dedicated refresh path.

### M-6.4 Rate limiting and download delivery

1. Apply both account and IP limits to authenticated writes.
2. Apply IP and edge limits to anonymous reads.
3. Use stricter request and byte limits for archive downloads.
4. Configure trusted proxy handling explicitly; never trust arbitrary
   `X-Forwarded-For`.
5. Return 429 with `Retry-After` and consistent rate-limit headers.
6. Deliver immutable archives through object storage/CDN where possible.
7. Avoid committing a database download-count update on every archive request.
   Buffer, batch, or asynchronously aggregate counters.
8. Add publish archive-size, daily-byte, version-count, and concurrency quotas for
   new accounts.
9. Keep health checks lightweight and separately protected from expensive public
   APIs.

### M-6 verification gate

- Catalog and search do not load all historical versions.
- Pagination and conditional requests work.
- Publish invalidation becomes visible promptly.
- Multi-instance limits share state.
- Archive floods do not cause synchronous database writes per request.
- Spoofed forwarding headers cannot bypass configured limits.
- Stale catalog responses are labeled and revocations propagate within the defined
  security window.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Catalog and search do not load all historical versions.
- Pagination and conditional requests (`ETag` / `If-None-Match`) work.
- Publish invalidation becomes visible promptly.
- Multi-instance limits share state.
- Archive floods do not cause synchronous database writes per request.
- Spoofed forwarding headers cannot bypass configured limits.
- Stale catalog responses are labeled; revocations propagate within the security window.
- Maintenance workers: count aggregation, cleanup, cache refresh.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-7**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
