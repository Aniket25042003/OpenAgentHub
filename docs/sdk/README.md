# SDK — `@openagenthub/sdk`

Framework-agnostic TypeScript library. Provides manifest validation, crypto,
pack/unpack, runtime detection, and the registry client. Used by the CLI and
the runtime engine.

## Modules

| File | Purpose |
| --- | --- |
| `src/manifest.ts` | Manifest load/parse/validate (`loadManifestFromDir`, `parseManifest`, `assertValidManifest`, `manifestToYaml`) + `Manifest` type |
| `src/crypto.ts` | Ed25519 keygen, `signPayload`/`verifyPayload`, `publicKeyFingerprint`, `sha256Hex` |
| `src/package.ts` | `packAgent`, `unpackAgent`, `SignatureFile`, `verifySignatureFile(Strict)`, `listProjectFiles`, `signaturePayload` |
| `src/runtime.ts` | `detectRuntime`, `checkAgentRequirements`, `decideSandbox`, `compareVersions`, `versionSatisfies` |
| `src/registry.ts` | `RegistryClient` + `AgentSummary`/`AgentVersionDetail`/`SearchOptions` types |
| `src/errors.ts` | `ArchiveError`, `SignatureError`, `RegistryError` |
| `src/schema/agent.schema.json` | Bundled copy of `specs/agent.schema.json` for runtime validation |

## What it does

- **Validate manifests** against the bundled JSON Schema (see
  [manifest.md](manifest.md)).
- **Pack & sign** agent directories into `.ahb` archives with `.sig.json`
  (see [package.md](package.md), [crypto.md](crypto.md)).
- **Unpack strictly** with traversal/symlink/size defenses.
- **Detect the runtime environment** (`detectRuntime`): python/node/docker/
  ollama/uv/git presence + versions, and **check requirements** against the
  manifest (`checkAgentRequirements`).
- **Decide the sandbox** (`decideSandbox`) → `{ mode: "container" |
  "isolated-process", reason }` (see
  [architecture/trust-model.md](../architecture/trust-model.md)).
- **Talk to the registry** (`RegistryClient`, see
  [registry-client.md](registry-client.md)).

## Sandbox selection

```ts
decideSandbox(manifest, detected, trustLevel):
  SandboxStrategy  // { mode: "container" | "isolated-process", reason }
```

- manifest `runtime.sandbox: container` → container
- manifest `runtime.sandbox: isolated-process` → isolated-process
- `untrusted` / `unknown` trust → container
- `trusted` / `local` → isolated-process (the "fast path")

## Testing

`node --test "test/*.test.ts"` from `sdk/` (quoted glob required). 30 tests:
manifest round-trips + validation failures, crypto sign/verify + fingerprint,
pack/unpack (AppleDouble exclusion, traversal/symlink/cap rejections,
`verifySignatureFileStrict`), runtime detection + requirement checks, sandbox
decisions, version comparisons, and registry client URL/shape behavior.
