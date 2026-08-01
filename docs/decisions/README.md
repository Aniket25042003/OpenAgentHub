# Architecture Decision Records

Every significant architectural decision, recorded so a new agent or human
can understand *why* the code is shaped the way it is.

| ADR | Decision |
| --- | --- |
| [ADR-0001 — Monorepo & workspaces](ADR-0001-monorepo.md) | One repo, npm workspaces, single source of truth |
| [ADR-0002 — Manifest format](ADR-0002-manifest-format.md) | `agent.yaml`, JSON Schema 2020-12, framework-agnostic |
| [ADR-0003 — Signing & trust](ADR-0003-signing-trust.md) | Ed25519 base64 signatures, `name@version:sha256` payload |
| [ADR-0004 — Hybrid sandbox](ADR-0004-hybrid-sandbox.md) | Process for trusted/local, hardened Docker otherwise |
| [ADR-0005 — Secrets vault](ADR-0005-secrets-vault.md) | AES-256-GCM, machine-bound master key |
| [ADR-0006 — Registry stack](ADR-0006-registry-stack.md) | FastAPI, SQLite/Postgres, fs blob store |
| [ADR-0007 — Zero-dependency agents](ADR-0007-zero-dependency-agents.md) | Stdlib-only reference agents |

## How to add one

1. Number it sequentially, name `ADR-00NN-<slug>.md`.
2. Use the Status / Context / Decision / Consequences shape.
3. Link it from this index and from the relevant component doc.
