# SDK — Manifest handling

## The manifest is the contract

`specs/agent.schema.json` (repo root) is the canonical JSON Schema
(2020-12). The SDK bundles a copy at `sdk/src/schema/agent.schema.json` for
runtime validation. **Never update one without the other.**

## Required fields

```yaml
manifestVersion: 1            # const, must be 1
name: namespace/name          # lowercase slug: ^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$
version: 0.1.0                # semver
author: your-github-username
description: "Does a thing"
license: MIT
runtime:                      # language is required
  language: python            # python | node | go | rust | other
  python: ">=3.11"            # optional PEP 440 specifier
  node: ">=18"                # optional semver range
  sandbox: auto               # auto | container | isolated-process
models:
  supported: [openai, anthropic, ollama]   # required, min 1
interfaces:                   # at least one of cli | mcp | http required
  cli:
    command: python app.py
    input: json               # json | args | stdin (default json)
    output: json              # json | text (default json)
```

`runtime` and `models` are required objects; `interfaces` must satisfy an
`anyOf` requiring at least one of `cli`/`mcp`/`http`.

## Optional fields

```yaml
framework:
  name: openagenthub            # object, NOT a string; required name
  version: "1.0"                # optional
homepage: https://...           # uri
repository: https://...         # uri
keywords: ["agents"]
permissions:                    # ARRAY; uniqueItems
  - network                     # filesystem|network|github|terminal|browser|camera|microphone|none
secrets:                        # ARRAY of env-var NAMES only (never values)
  - GITHUB_TOKEN                # ^[A-Z][A-Z0-9_]*$
dependencies:
  pip: ["requests"]             # arrays of strings
  npm: ["undici"]
  system: ["curl"]
tools: ["read_file"]            # tool names the agent exposes
tags: ["productivity"]          # max 20
```

Interfaces detail:

```yaml
interfaces:
  mcp:
    entrypoint: python mcp_server.py
    transport: stdio            # stdio | http | sse (default stdio)
    tools: ["summarize_notes"]
  http:
    endpoint: https://...       # uri
    methods: [POST]             # GET | POST (default [POST])
```

## Validation rules baked into the schema

- `additionalProperties: false` everywhere — unknown keys are rejected.
- `permissions` entries must be in the capability enum; `none` must not be
  combined with others.
- `secrets` entries must look like env-var names.
- `name` is `namespace/name` (single string) — **there is no separate
  `namespace` field**. The registry + CLI split it on `/`.
- `framework` is an **object** `{name, version?}` — the registry stores only
  `name` (string) in the agents table.
- `manifestVersion` must be exactly `1` (`const`).

## Loaders (`sdk/src/manifest.ts`)

```ts
loadManifestFromDir(dir): { manifest: Manifest; path: string }
assertValidManifest(manifest): Manifest      // throws with detailed error
parseManifest(yamlOrJson: string): Manifest
manifestToYaml(manifest): string
```

- `loadManifestFromDir` finds `agent.yaml` or `manifest.yaml` at the root.
- `packAgent`/`unpackAgent` record which file was found (`agent.yaml` or
  `manifest.yaml` basename).
- The CLI `validate`/`init`/`publish` commands all go through these loaders.

## Keeping schema + SDK in sync

1. Edit `specs/agent.schema.json`.
2. Copy it to `sdk/src/schema/agent.schema.json`.
3. Rebuild (`npm run build`) and run SDK tests — the manifest round-trip test
   will catch drift.
