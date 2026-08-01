# ADR-0002 — Manifest format

**Status:** Accepted

## Context

Agents can be written in any language/framework. To make a universal package
manager, we need one declarative contract that describes *what an agent is* —
its runtime, its interfaces, its permissions — independent of how it's
implemented.

## Decision

- One manifest per agent: `agent.yaml` (or `manifest.yaml`), validated by
  `specs/agent.schema.json` (JSON Schema **2020-12**, `additionalProperties:
  false`).
- Required fields: `manifestVersion` (const `1`), `name`
  (`namespace/name`, single string), `version` (semver), `author`,
  `description`, `license`, `runtime`, `models`, and at least one of
  `interfaces.cli` / `interfaces.mcp` / `interfaces.http`.
- `runtime` is `{ language, python?, node?, sandbox? }` with
  `sandbox: auto | container | isolated-process`.
- `models.supported` is a list of provider names
  (`openai, anthropic, google, deepseek, ollama, mistral, xai, groq, local,
  custom`).
- `permissions` is an **array** of capability strings; `secrets` is an
  **array** of env-var *names*.
- `framework` is an optional **object** `{name, version?}` (required `name`);
  the registry stores only the name as a string.

## Consequences

- The schema is strict and versioned (`manifestVersion`); invalid manifests
  are rejected at pack, publish, and install time.
- Names are slugs embedded in `name` (`ns/name`) — there is no separate
  namespace field.
- Manifest shapes are easy to get wrong and must never be silently changed —
  see the invariants list in `AGENTS.md`.

## Alternatives considered

- JSON manifests → YAML reads better for humans and supports comments.
- Multiple manifest formats per language → defeats universality.
