# M-2 — Secure local control plane and dashboard lifecycle

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-1 complete. Resolve open decision #3 (Windows autostart) before finishing.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `cli/src/lib/`, `cli/src/commands/dashboard/`, `web/`, `runtime/src/config.ts`.

## Suggested branches / PRs

- `feat/local-control-plane` — M-2

## Implementation plan

The local control plane is not merely a detached Next.js process. It owns shared
local state and later supervises long-running agents.

Architecture alignment:

- Implement daemon lifecycle, local API, state, and supervisor coordination as
  in-process modules behind one local control-plane entrypoint.
- Keep the local Next.js UI as a client of that control plane.
- Keep hosted API communication behind one versioned client adapter.
- Do not create separate daemon, dashboard API, usage, or supervisor network services.

### M-2.1 Process lifecycle

1. Add start, stop, restart, status, health, logs, and open operations.
2. Persist PID, process start identity, port, product version, protocol version,
   started-at timestamp, and health state under `$AGENT_HOME`.
3. Use a startup lock so simultaneous CLI commands cannot launch duplicate daemons.
4. Write state atomically.
5. Verify process identity before signaling a stored PID.
6. Handle stale state, PID reuse, failed startup, partial upgrade, and port collision.
7. Rotate logs and impose retention/size limits.
8. Restart automatically when CLI/control-plane protocol versions are incompatible.

### M-2.2 Local API security

1. Bind TCP listeners only to loopback addresses.
2. Use a random local authentication token with restrictive file permissions.
3. Validate `Host` and `Origin` headers to reduce DNS-rebinding and cross-site attacks.
4. Protect mutation endpoints against CSRF.
5. Do not return secrets, raw credentials, prompts, or environment values.
6. Separate cheap `/health` and `/version` endpoints from expensive system snapshots.
7. Version the local API.
8. Use Unix domain sockets or named pipes for CLI RPC where practical; use loopback
   HTTP for browser access.

### M-2.3 Command semantics

1. `openagenthub` starts/reuses the daemon and opens the dashboard.
2. `openagenthub dashboard open` starts if necessary and opens the browser.
3. `openagenthub dashboard start|stop|restart|status|logs` provides explicit control.
4. One-shot commands do not open a browser.
5. Commands requiring supervision start the control plane lazily.
6. Honor `OPENAGENTHUB_NO_DAEMON=1`.
7. Add `openagenthub dashboard autostart on|off`.
8. Support launchd and systemd-user autostart initially; document Windows manual
   startup until a tested implementation exists.

### M-2 verification gate

- Concurrent startup creates one daemon.
- Port collision selects and records a safe alternate port.
- Stale and reused PIDs do not terminate unrelated processes.
- Loopback API rejects missing authentication and unsafe origins.
- Daemon survives terminal closure when intentionally detached.
- CI can run every CLI command without spawning a daemon.
- Version upgrade restarts the correct old process safely.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Concurrent startup creates one daemon.
- Port collision selects and records a safe alternate port.
- Stale and reused PIDs do not terminate unrelated processes.
- Loopback API rejects missing authentication and unsafe origins.
- Daemon survives terminal closure when intentionally detached.
- CI can run every CLI command with `OPENAGENTHUB_NO_DAEMON=1`.
- Version upgrade restarts the correct old process safely.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-3**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
