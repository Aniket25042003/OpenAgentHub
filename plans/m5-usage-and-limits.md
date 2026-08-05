# M-5 — Third-party usage and subscription adapters

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-4 complete. Resolve open decision #1 (Node floor) before OpenCode SQLite parsing.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `runtime/src/usage/`, `runtime/src/system/`, `cli/src/commands/`, `web/src/`.

## Suggested branches / PRs

- `feat/usage-limit-adapters` — M-5

## Implementation plan

Architecture alignment:

- Claude, Codex, and OpenCode integrations are local adapter modules loaded by the
  control plane.
- Adapters return one normalized domain contract and cannot write unrelated local
  state.
- Parser isolation uses bounded subprocesses or worker threads only where required
  for safety/timeboxing; adapters are not independently deployed cloud services.
- Optional provider network calls go through one consent-aware integration module.

### M-5.1 Detection prerequisites

1. Add explicit detection metadata for Claude Code, Codex, and OpenCode rather than
   assuming they map to the existing OpenClaw/Hermes catalog.
2. Separate process detection from usage-source discovery.
3. Add fixture directories and synthetic records for every supported format.
4. Version each adapter and allow it to report unsupported schema changes.
5. Timebox each adapter so one huge or corrupt directory cannot block `/api/system`.

### M-5.2 Usage adapters

- **OpenCode**
  - Open its SQLite database read-only.
  - Do not attempt to change journal or WAL mode.
  - Handle WAL side files, locks, schema changes, and unsupported Node versions.
  - Read tokens, exact stored cost where available, model, agent, and timestamps.
- **Claude Code**
  - Incrementally scan compatible JSONL session records.
  - Track file identity, size, mtime, and byte offset.
  - Handle truncation, replacement, partial final lines, old schemas, and malformed
    events.
  - Estimate cost through a versioned pricing table when exact cost is absent.
- **Codex**
  - Parse compatible rollout/session JSONL.
  - Determine whether token records are cumulative totals or event deltas before
    aggregation.
  - Prevent duplicate counting across repeated observations.
  - Treat missing or changed rate-limit records as unavailable, not zero.

### M-5.3 Subscription-limit model

1. Support multiple simultaneous windows per provider.
2. Store plan, percentage, units, reset time, credits, observation time, freshness,
   and source.
3. Add:
   - `openagenthub limits`;
   - `openagenthub limits --json`;
   - `openagenthub limits set <provider> ...` for manual values;
   - `openagenthub integrations enable|disable|status`.
4. Do not reference a nonexistent generic `openagenthub config` command.
5. Label stale cached data and adapter errors.
6. Keep cross-machine aggregation explicitly out of scope.

### M-5.4 Live integration consent

1. Local parsing is the default.
2. Reading a third-party credential file requires explicit integration consent.
3. Calling unofficial provider APIs requires a separate explicit opt-in.
4. Explain which files and endpoints are accessed before enabling.
5. Never copy OAuth tokens into OpenAgentHub configuration or logs.
6. Store optional OpenAI API keys only in the existing encrypted vault.
7. Cache only normalized limit results, never raw authorization headers.
8. Use short network timeouts and graceful fallback.
9. Treat unofficial Anthropic usage behavior as experimental and feature-flagged.
10. Mock all live APIs in tests; CI must never require real provider credentials.

### M-5 verification gate

- Fixture-based adapters produce deterministic normalized observations.
- Huge, locked, partial, malformed, or changed data sources do not block the
  dashboard.
- Repeated parsing does not duplicate usage.
- Live APIs and credential-file access are off by default.
- Revoking integration consent stops future access and clears sensitive caches.
- Missing data is shown as unavailable rather than zero.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Fixture-based adapters produce deterministic normalized observations.
- Huge, locked, partial, malformed, or changed data sources do not block the dashboard.
- Repeated parsing does not duplicate usage.
- Live APIs and credential-file access are off by default.
- Revoking integration consent stops future access and clears sensitive caches.
- Missing data is shown as unavailable rather than zero.
- Mock all live APIs; CI never requires real provider credentials.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-6**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
