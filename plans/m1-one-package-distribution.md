# M-1 — Rename and single-package distribution

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-0 complete and merged.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `cli/`, `web/`, `docs/`, `marketing/`, `test/e2e.sh`, `AGENTS.md`, `README.md`.

## Suggested branches / PRs

- `feat/one-package-distribution` — M-1

## Implementation plan

Architecture alignment:

- The packaged CLI and dashboard consume generated API contracts; they do not embed
  hosted registry business logic.
- The bundled local product remains one modular control-plane process with adapters,
  not a set of local microservices.
- Packaging hosted API modules or worker dependencies into the end-user CLI is
  avoided unless they are genuinely needed locally.

### M-1.1 CLI migration

1. Add `openagenthub` as the primary bin and oclif name.
2. Keep `agent` as a one-release deprecation alias.
3. Update command output, errors, docs, examples, marketing copy, dashboard copy,
   e2e scripts, AGENTS.md, and release assets.
4. Document the alias-removal timeline.
5. Decide and reserve the npm package name before public release.

### M-1.2 Dashboard packaging

1. Add the web build to release and CI pipelines; the current root build does not
   build `web`.
2. Build Next.js standalone output before packaging the CLI.
3. Copy the standalone server, `.next/static`, and `public` assets into a versioned
   CLI package directory.
4. Add a strict npm `files` allowlist.
5. Ensure traced SDK/runtime dependencies resolve in a clean global install.
6. Replace workspace wildcard dependencies in published artifacts with release
   versions.
7. Pass registry and local-control-plane URLs at run time rather than relying on
   build-time-only `NEXT_PUBLIC_*` values.
8. Define a maximum package-size budget and report it in CI.

### M-1.3 Clean-install and upgrade verification

1. Run `npm pack`.
2. Install the tarball into an empty temporary prefix without workspace symlinks.
3. Verify CLI help, SDK/runtime loading, dashboard static assets, and `/health`.
4. Verify installation paths containing spaces.
5. Verify upgrades detect an older running daemon and perform a safe restart.
6. Verify uninstall leaves user data unless an explicit purge command is used.
7. Keep Homebrew and standalone binary copy disabled or marked as upcoming until
   their release pipelines exist.

### M-1 verification gate

- One npm artifact installs the CLI and dashboard in a clean environment.
- `openagenthub` works globally.
- `agent` remains a temporary compatibility alias.
- The dashboard starts without access to the monorepo.
- Package contents contain only intended runtime files.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- `npm pack` then clean-prefix install without workspace symlinks.
- CLI help, SDK/runtime loading, dashboard static assets, `/health`.
- Paths containing spaces.
- Upgrade detects older daemon and restarts safely (smoke once M-2 lands; packaging hooks ready here).
- Uninstall leaves user data unless purge is explicit.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-2**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
