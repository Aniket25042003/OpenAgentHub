# ADR-0001 — Monorepo & npm workspaces

**Status:** Accepted

## Context

OpenAgentHub spans a TypeScript SDK, a runtime engine, a CLI, a website, a
Python registry, and specs. We needed a layout where: (a) the SDK, runtime,
and CLI stay in one versioned unit, (b) the website can import the SDK's
types, and (c) humans and agents can reason about the whole system from one
place.

## Decision

- Single repository, npm workspaces at the root: `sdk`, `runtime`, `cli`,
  `web`.
- Shared config/scripts at the root `package.json` (`npm run build` builds
  sdk → runtime → cli in dependency order; `npm run test` runs all suites).
- The Python registry lives at `registry/` (managed with `uv`), the spec at
  `specs/`, docs at `docs/`, examples at `examples/`, e2e at `test/`.
- The JSON Schema in `specs/agent.schema.json` is the **single source of
  truth**; the SDK carries a bundled copy for runtime validation and the two
  must stay in sync.

## Consequences

- Build order matters and is enforced by the root scripts.
- Cross-package type sharing is trivial (workspace deps).
- The monorepo root needs `next.config.mjs` `outputFileTracingRoot` set so the
  Next.js web app's standalone tracing includes the shared SDK.

## Alternatives considered

- Separate repos per package → more release overhead, drift risk.
- One big package → no clear ownership boundaries; would block the Python
  registry.
