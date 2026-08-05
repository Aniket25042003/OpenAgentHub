# Trust Model

The core question: **how much isolation does this agent need?** The answer is
decided at run time and maps to a sandbox.

## Trust levels

| Level | Where it comes from | Sandbox |
| --- | --- | --- |
| `trusted` | Reserved for explicitly trusted local installs (not currently produced by any install source) | isolated-process |
| `local` | Installed from a local directory (`openagenthub install --dir ...`) — the user authored it themselves | isolated-process |
| `unknown` | Registry install where the archive is not flagged — the default | container |
| `untrusted` | Registry install where the security scan flagged the archive | container |

The registry **never reports `trusted`**: `AgentSummary.trust`/detail `trust`
is `"unknown"` unless `security_status == "flagged"`, which yields
`"untrusted"`. The CLI installer maps that onto the trust level stored in
`config.json`.

## Decision function

`sdk/src/runtime.ts`:

```ts
decideSandbox(manifest, detected, trustLevel): SandboxStrategy
// { mode: "container" | "isolated-process", reason }
```

Order of precedence:

1. `manifest.runtime.sandbox === "container"` → container
2. `manifest.runtime.sandbox === "isolated-process"` → isolated-process
3. `untrusted` → container ("agent is untrusted; requires container isolation")
4. `unknown` → container ("trust unknown; defaulting to container isolation")
5. `trusted` / `local` → isolated-process ("fast isolated-process path")

The manifest can only *request* a stricter sandbox; a request to force
`isolated-process` for an unknown/untrusted agent never happens because the
trust level wins unless the manifest asked for a stricter mode.

## Why container-by-default

Agents are arbitrary code. A registry package is authored by someone you may
not know, so it must not touch your filesystem or network by default. The
container path applies a hardened docker config (see
[sandbox-container.md](../runtime/sandbox-container.md)) that grants only the
declared permissions.

## Enforcement of the invariant

- The runtime (`runtime/src/runtime.ts`) constructs `ProcessSandbox` only when
  `trustLevel` is `trusted`/`local` — it throws an internal error otherwise.
- `ProcessSandbox`'s constructor independently rejects `untrusted`/`unknown`.
- If Docker is unavailable, the runtime fails closed (no silent downgrade).

## Permission granting

Even trusted agents can't exceed their manifest's declared permissions:

- `permissions: ["network"]` → container `--network host`; process path may
  install deps.
- `permissions: ["filesystem"]` → container writable `/work` tmpfs.
- `permissions: ["none"]` (or omitted) → `--network none`, read-only root.

At install time the CLI asks the user to grant each requested permission
(unless `--yes` / `--no-permissions`) and persists the grants. The granted
set is what the runtime passes to the sandbox — the manifest declares the
ceiling, the user grant is the actual floor.

## Signature / identity

Trust also depends on *who signed the archive*:

- Archives carry the author's Ed25519 public key + fingerprint
  (`SignatureFile`).
- Signatures are verified at publish (registry) and at install (client).
- The registry records the key fingerprint with each version (`signatureKeyId`
  on install) and exposes it via `openagenthub verify`.
- Key registration (`POST /api/v1/keys`) is the foundation for
  verified-publisher attribution, but today trust is still derived from the
  security scan, not publisher verification.
