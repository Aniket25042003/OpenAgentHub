# ADR-0004 — Hybrid sandbox

**Status:** Accepted

## Context

Every installed agent is arbitrary code. But not all agents deserve the same
treatment: locally-authored code can run fast and natively, while
registry-downloaded code from unknown authors must be strictly isolated. A
single isolation strategy for everything would be either insecure or
impractically slow.

## Decision

- **Isolated-process sandbox** (`ProcessSandbox`) for `trusted` and `local`
  agents: direct child-process execution, dependency install on demand, plus
  a shell-metacharacter rejection guard. Fast, no Docker dependency, still not
  a security boundary.
- **Container sandbox** (`ContainerSandbox`) for `unknown` and `untrusted`
  agents: hardened Docker run with `--cap-drop ALL`,
  `--security-opt no-new-privileges`, `--pids-limit 256`, `--memory 512m`,
  `--cpus 1`, `--user 10001:10001`, `--network none` unless `network` is
  granted, `--read-only` (or a `/work` tmpfs when `filesystem` is granted),
  `--rm`, and **`--interactive`** (mandatory for stdin piping).
- `decideSandbox(manifest, detected, trust)` in the SDK maps trust → sandbox
  mode (`container` | `isolated-process`). The manifest can request a stricter
  sandbox (`sandbox: container`), but unknown/untrusted agents always land in
  the container.
- If Docker is unavailable, the runtime **fails closed** — it never silently
  falls back to the process path; `ProcessSandbox` itself rejects
  unknown/untrusted trust levels.

## Consequences

- Trust is recorded in `config.json` per installed agent; it drives sandbox
  selection at run time.
- Docker is a hard requirement for installing/using registry agents.
- The container is the default for registry installs; local (`--dir`) installs
  opt into the fast path.

## Alternatives considered

- Containers always → slow + Docker dependency even for local dev.
- Process always → no security for registry packages.
