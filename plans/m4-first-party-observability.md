# M-4 — First-party observability and dashboard stats

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-3 complete.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `runtime/src/`, `cli/src/commands/`, `web/src/`.

## Suggested branches / PRs

- `feat/first-party-observability` — M-4

## Implementation plan

OpenAgentHub-owned run records are the reliable foundation for statistics.

Architecture alignment:

- Observability aggregation is a local module over the local run store.
- The local dashboard API calls this module; it does not query storage directly.
- Hosted upload is absent unless the later device-enrollment boundary is explicitly
  enabled.
- Expensive local aggregation may use in-process jobs, but does not require a hosted
  analytics microservice in this milestone.

### M-4.1 Local run and usage store

1. Select a transactional local store with schema versioning and migrations.
2. Store run metadata, health transitions, resource observations, token counters, and
   pricing references.
3. Keep raw logs separate from structured metrics.
4. Bound retention and provide:
   - `openagenthub history prune`;
   - dashboard retention settings;
   - optional automatic cleanup.
5. Prevent concurrent corruption by routing writes through the control plane.
6. Provide export/delete controls for local data.

### M-4.2 Statistics

Show:

- currently running agents;
- healthy, unhealthy, and stopped runs;
- running-since and elapsed duration;
- runs today and all time;
- current containers and historical container runs;
- tokens by input/output/reasoning/cache category;
- exact and estimated cost separated;
- model/provider usage;
- sandbox mode and security status;
- last successful and failed run.

### M-4.3 Dashboard and CLI surfaces

1. Extend the local API and dashboard with aggregate and per-agent views.
2. Add CLI JSON output for automation.
3. Distinguish zero usage from unavailable data.
4. Display observation freshness and last refresh.
5. Keep expensive aggregation cached and invalidate it after new events.
6. Provide date-range filters without loading all history into browser memory.

### M-4 verification gate

- A supervised run produces one durable run record.
- Current and historical container counts remain accurate after container removal.
- Duration and status survive daemon restart.
- Exact and estimated costs are not combined without labels.
- No prompts, responses, secrets, or environment values appear in usage storage or
  API responses.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Supervised run produces one durable run record.
- Current and historical container counts remain accurate after container removal.
- Duration and status survive daemon restart.
- Exact and estimated costs are not combined without labels.
- No prompts, responses, secrets, or environment values in usage storage or API responses.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-5**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
