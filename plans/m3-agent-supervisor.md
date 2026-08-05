# M-3 — Agent lifecycle supervisor

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-2 complete.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `cli/src/commands/`, `runtime/src/sandbox/`, `runtime/src/runtime.ts`, `runtime/src/system/`.

## Suggested branches / PRs

- `feat/agent-supervisor` — M-3

## Implementation plan

M-3 supplies the Docker-like run management that a dashboard-only daemon cannot.

Architecture alignment:

- The supervisor is a local control-plane module with process and container adapters.
- Commands call supervisor application use cases rather than Docker directly.
- Run state, policy checks, logs, and reconciliation share one local transaction and
  event model.
- Future runtime adapters can be added in process without introducing a service per
  runtime.

### M-3.1 Run commands

Add and standardize:

- `openagenthub run <agent>` for foreground execution;
- `openagenthub run <agent> --detach` for managed background execution;
- `openagenthub stop <run-id>`;
- `openagenthub restart <run-id>`;
- `openagenthub logs <run-id> [--follow]`;
- `openagenthub inspect <run-id>`;
- `openagenthub ps [--all]`;
- `openagenthub history`;
- `openagenthub remove <run-id>` for run-history cleanup without uninstalling the
  package.

### M-3.2 Stable run identity and health

1. Generate a stable run ID before process/container creation.
2. Add Docker labels for run ID, agent, version, digest, interface, sandbox, and
   manager version.
3. Track process/container identity without relying on dependency-volume names.
4. Record start, running, healthy, unhealthy, stopping, exited, failed, and orphaned
   states.
5. Support interface-specific health checks where possible.
6. Define port allocation and conflict behavior for HTTP/MCP servers.
7. Define restart policies explicitly; default to no automatic restart for untrusted
   agents.
8. Reconcile daemon state with Docker and host processes after crashes or reboot.

### M-3.3 Logs and resource limits

1. Capture stdout/stderr with bounded files and rotation.
2. Avoid holding unlimited output in memory for one-shot runs.
3. Record exit code, signal, timeout, out-of-memory, and manual-stop reasons.
4. Expose current resource use where Docker supports it.
5. Apply time, memory, CPU, PID, writable-disk, and output limits.
6. Ensure `stop` escalates safely from graceful termination to forced termination.

### M-3 verification gate

- Detached CLI, MCP, and supported HTTP agents can be started, listed, inspected,
  logged, stopped, and reconciled after daemon restart.
- Run history remains after `--rm` containers disappear.
- Containers are matched through labels.
- Orphaned processes and containers are detected without killing unrelated work.
- Revocation and sandbox policy are rechecked before restart.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Detached CLI/MCP/HTTP agents: start, list, inspect, logs, stop, reconcile after daemon restart.
- Run history remains after `--rm` containers disappear.
- Containers matched through labels, not volume-name heuristics alone.
- Orphan detection without killing unrelated work.
- Revocation and sandbox policy rechecked before restart.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-4**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
