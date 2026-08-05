# M-0 — Security and correctness foundation

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- None (first milestone). Resolve open decisions #2 and #4 in [plan.md](../plan.md) before finishing.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `registry/`, `sdk/`, `runtime/`, `cli/`, `specs/`, `test/`.

## Suggested branches / PRs

- `refactor/modular-api-foundation` — M-0.0
- `security/publisher-ownership-and-keys` — M-0.1–M-0.3
- `security/review-sandbox-permissions` — M-0.4–M-0.7
- `fix/cli-runtime-correctness` — M-0.8

## Implementation plan

M-0 blocks public-registry growth and all later milestones that would increase package
distribution. It should be delivered in small reviewable PRs rather than one large
security rewrite.

### M-0.0 Modular API and worker foundation

1. Add an architecture decision record selecting:
   - one hosted FastAPI modular monolith;
   - independently deployed asynchronous workers;
   - one PostgreSQL cluster with module-owned tables/write paths;
   - shared cache, durable queue, transactional outbox, and object storage;
   - one versioned OpenAPI contract for CLI and web.
2. Organize the registry backend into domain/application/infrastructure layers without
   changing externally visible behavior first.
3. Establish modules for identity, organizations/authorization, registry/packages,
   security/review, quotas/entitlements, and audit.
4. Move business decisions out of routers into tested application use cases.
5. Add repository interfaces and transaction boundaries; prohibit client or frontend
   database access.
6. Add outbox schema, dispatcher, durable queue abstraction, idempotent worker base,
   retry/backoff, and dead-letter handling.
7. Create independently deployable worker entrypoints for scanning, notifications,
   billing reconciliation, and maintenance while retaining one monorepo.
8. Publish the OpenAPI schema and add generated-client/contract validation in CI.
9. Add request IDs, structured logging, metrics, tracing context, health/readiness,
   and dependency status for API and workers.
10. Document module ownership and enforce import boundaries through linting or
    architecture tests where practical.
11. Avoid premature per-module databases or internal HTTP calls.
12. Preserve one-command local development that starts API, required infrastructure,
    and worker processes together.

### M-0.1 Publisher authentication and authorization

1. Keep public read routes anonymous.
2. Require an authenticated active publisher account for publish, key-management,
   namespace-management, and scan-request operations.
3. Bind each namespace to one account or organization.
4. Check namespace/package ownership on every new version.
5. Add maintainers through an explicit ACL rather than relying on manifest `author`.
6. Reserve official-looking names and common vendor names for manual review.
7. Reject cross-account version publication with a clear 403 response.
8. Record publish, key, namespace, role, suspension, and review events in an audit log.
9. Add new-account publish quotas and account/IP throttling.
10. Add administrative suspension and package-yank controls.

### M-0.2 Signing-key ownership and lifecycle

1. Require the signature key fingerprint to match an active key owned by the
   authenticated account or its organization.
2. Reject embedded public keys that are not registered to the publisher.
3. Preserve Ed25519 signing over package identity and archive digest.
4. Add key labels, rotation, expiration, and revocation.
5. Prevent a revoked key from signing new versions.
6. Preserve verification of already published historical versions while clearly
   surfacing that their key was later revoked.
7. Add tests for wrong-user keys, unknown keys, revoked keys, rotated keys, and
   malformed signatures.

### M-0.3 Canonical manifest and archive validation

1. Validate registry manifests against the canonical schema before database writes.
2. Keep `specs/agent.schema.json` and the SDK schema copy in lockstep.
3. Enforce the `permissions: ["none"]` exclusivity rule in schema or shared
   validation.
4. Require one exact root `agent.yaml`; reject duplicate or nested alternatives.
5. Add aggregate uncompressed archive-size and entry-count limits to registry scans.
6. Reject unsafe tar member types, links, devices, traversal, absolute paths, NUL
   paths, and oversized members.
7. Exclude common secret files such as `.env`, private keys, credential files, and
   local vault data during packing, with an explicit allow mechanism only if needed.
8. Align documentation with implemented scanner capabilities. Do not claim
   dependency, license, or secret scanning until it exists.

### M-0.4 Review, quarantine, and revocation backend

1. Add structured scan and review status fields.
2. Default new versions to `pending` or `unverified`.
3. Run required archive and manifest checks before public availability.
4. Block rejected, revoked, and known-malicious versions from normal download,
   install, update, and run paths.
5. Require authenticated reviewer/admin roles for manual status changes.
6. Authenticate and throttle rescan requests; deduplicate concurrent scans.
7. Record the exact reviewed digest, signer key, reviewer, timestamp, and reason.
8. Expose a signed or authenticated revocation feed suitable for client refresh.
9. Define behavior for offline clients: retain the last-known status, warn when
   stale, and default to container isolation rather than silently trusting.

### M-0.5 Sandbox decision and user override

1. Change sandbox decision order so revocation and source trust are evaluated before
   manifest preference.
2. Permit a manifest to force `container`, but never to force host process execution.
3. Derive effective sandbox at run time from immutable package metadata and local
   sandbox policy.
4. Add:
   - `openagenthub sandbox show <agent>`;
   - `openagenthub sandbox set <agent>@<version> container`;
   - `openagenthub sandbox set <agent>@<version> process`;
   - `openagenthub sandbox reset <agent>@<version>`.
5. Require a risk confirmation for `process`; provide a non-interactive
   `--acknowledge-risk` flag instead of allowing generic `--yes`.
6. Bind process overrides to archive digest and reset them on update.
7. Display source trust, review status, requested sandbox, local policy, and effective
   sandbox separately.
8. Fail closed with actionable Docker installation guidance when a container is
   required but unavailable.

### M-0.6 Permission and secret enforcement

1. At run time compute:
   `effective = saved grants ∩ current manifest requests ∩ platform policy`.
2. Refuse grants that are absent from the manifest.
3. Replace generic host filesystem access with explicit paths and read/write modes
   before any host directory mounts are introduced.
4. Keep container network disabled by default; design optional destination
   allowlists instead of only a global network boolean.
5. Treat unsupported permissions as descriptive only until an enforcement adapter
   exists, and label them accordingly.
6. Ask separately before exposing each stored secret to an agent.
7. Never put secrets in logs, dashboard responses, daemon state, or run history.
8. Document that a network-enabled agent can exfiltrate secrets intentionally
   provided to it even when containerized.
9. Prefer an environment file or runtime-supported secret mechanism over including
   secret values directly in visible Docker command arguments.

### M-0.7 Container and dependency hardening

1. Pin base images to reviewed digests while retaining human-readable tags in
   metadata.
2. Label every managed container with package, version, digest, run ID, sandbox, and
   OpenAgentHub ownership metadata.
3. Never mount the Docker socket, host devices, or broad host directories by default.
4. Bound writable tmpfs size, log size, run duration, output size, and dependency
   cache growth.
5. Define cleanup for dependency volumes, interrupted installs, stopped runs, and
   abandoned containers.
6. Validate dependency lockfiles and record resolved dependency metadata for
   reproducibility.
7. Explicitly reject unsupported `dependencies.system` behavior until a safe
   installation mechanism exists.
8. Evaluate rootless Docker or compatible runtimes as an optional stronger local
   configuration, without delaying the initial Docker path.

### M-0.8 Existing correctness fixes

1. Correct `update` to choose the actual latest version.
2. Make version resolution deterministic across `run`, `env`, `verify`, `uninstall`,
   and related commands when multiple versions are installed.
3. Implement `install --force` semantics or remove the flag.
4. Stop treating corrupt `config.json` as an empty configuration; preserve the file
   and show recovery instructions.
5. Distinguish a missing secret set from decryption failure or vault corruption.
6. Make config and permission writes atomic and safe against concurrent processes.
7. Test unsigned local archives, flagged registry archives, isolated-process manifest
   requests, permission escalation, and Docker-unavailable behavior.

### M-0 verification gate

- The hosted API deploys as one modular application and exposes one versioned
  contract to CLI and web.
- Module-boundary tests prevent routers/frontends from bypassing application policies
  or directly mutating another module's tables.
- Outbox publication and worker execution survive process crashes and duplicate job
  delivery.
- Cross-user publishing is rejected.
- Unknown, wrong-owner, expired, and revoked signing keys are rejected.
- Invalid manifests cannot enter the registry.
- Revoked or rejected versions cannot be newly installed or run normally.
- Unverified registry agents run in containers by default.
- An explicit process override is version/digest scoped and resets on update.
- Saved permission tampering cannot exceed manifest or platform policy.
- Existing SDK, runtime, CLI, registry, and e2e suites pass.
- New adversarial registry and runtime tests pass.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Module import/ownership boundaries, application use cases, and repository contracts.
- OpenAPI compatibility and generated TypeScript client drift.
- Outbox dispatch, worker idempotency, retries, dead-letter behavior.
- Two publisher accounts attempting cross-namespace publication.
- Signature ownership, wrong-user keys, revoked keys, rotated keys.
- Sandbox decision matrix: source trust × review status × manifest preference × local policy × Docker availability.
- Permission intersection and secret exposure decisions.
- Publish → scan → pending → admin verify → install.
- Publish → flag/revoke → blocked install and blocked run.
- Explicit host override → package update → override reset.
- API transaction → outbox → queue → worker → module-owned result persistence.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-1**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
