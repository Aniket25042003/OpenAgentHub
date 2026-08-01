# OpenAgentHub Documentation

Reference documentation for the OpenAgentHub project. Written for both humans
and AI agents who are new to the codebase. Start with the architecture
overview, then drill into the component that interests you.

## Quick navigation

| Topic | Document |
| --- | --- |
| System overview, components, data flows | [architecture/overview.md](architecture/overview.md) |
| How trust and sandboxing decisions work | [architecture/trust-model.md](architecture/trust-model.md) |
| The `.ahb` package format and signing | [architecture/packaging.md](architecture/packaging.md) |
| Secrets vault design | [architecture/secrets.md](architecture/secrets.md) |
| How an agent actually runs | [architecture/execution.md](architecture/execution.md) |
| SDK (TypeScript library) | [sdk/README.md](sdk/README.md) |
| Runtime engine | [runtime/README.md](runtime/README.md) |
| CLI (`agent` command) | [cli/README.md](cli/README.md) |
| Registry backend (FastAPI) | [registry/README.md](registry/README.md) |
| Website (Next.js) | [web/README.md](web/README.md) |
| Reference agents | [examples/README.md](examples/README.md) |
| Architectural decision records | [decisions/](decisions/) |

## Reading order for new contributors

1. `../AGENTS.md` — ground rules, invariants, commands, gotchas (repo root).
2. `architecture/overview.md` — mental model of the whole system.
3. `specs/SPEC.md` — the agent manifest specification (repo root).
4. Then dive into a component: `sdk/`, `runtime/`, `cli/`, `registry/`, `web/`.

## Conventions used in this project

- The manifest (`agent.yaml`) is the single source of truth for what an agent is.
- Everything shipped is signed and verified; nothing runs unsandboxed unless
  explicitly trusted.
- Tests: Node built-in runner for TS packages (`node --test "test/*.test.ts"`),
  pytest for the registry.
- No code comments unless asked — this documentation tree is where the "why"
  lives.
