# ADR-0007 — Zero-dependency agents

**Status:** Accepted

## Context

Registry installs of unknown agents run in a container with `--network none`
by default. If an agent needs external packages (`requests`, etc.), the
sandbox must install them, which requires network access, slows first run, and
adds a moving part. Reference agents should demonstrate clean patterns, not
dependencies.

## Decision

- Reference agents (`examples/*`) use **only the Python standard library**.
- No `dependencies.pip`/`npm` in reference manifests.
- The `github-pr-reviewer` example talks to GitHub using `urllib` +
  `os.environ["GITHUB_TOKEN"]`, and only declares `network` because it
  genuinely needs it.
- Container installs of reference agents therefore need no dependency step.

## Consequences

- First container run is fast and offline-safe.
- Examples stay readable as living documentation.
- Dependency support still exists (process + container paths) for real agents,
  gated on `network` permission — we just don't lean on it in examples.

## Alternatives considered

- Heavy example agents with package installs → slower tests, noisier docs,
  more surface area for the e2e harness.
