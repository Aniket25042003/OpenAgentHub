# ADR-0003 — Signing & trust

**Status:** Accepted

## Context

A package registry only works if consumers can trust what they install.
Without integrity guarantees, a compromised or malicious archive could execute
arbitrary code on a user's machine. We needed cryptographic integrity and
identity that works across the TS SDK and the Python registry.

## Decision

- **Algorithm**: Ed25519 keypairs.
- **Signature encoding**: **base64** strings (not hex) — this became a
  requirement for the Python registry, which must `base64.b64decode`.
- **Signed payload**: the literal string
  `openagenthub-signature-v1:<name>@<version>:<sha256>` where `<name>` is the
  full `namespace/name` and `<sha256>` is the hex digest of the archive bytes.
  This binds the signature to both the exact identity and the exact bytes.
- **Signature file** (`<name>_<version>.ahb.sig.json`): a `SignatureFile` JSON
  object — `{ schemaVersion: 1, algorithm: "ed25519", publicKey, publicKeyId,
  sha256, name, version, signature }`. `publicKeyId` is
  `sha256(SPKI DER)[:16]`.
- **Verification points**: at publish (registry, before storage) and at
  install (client, before unpack) via `verifySignatureFileStrict` (checks
  schema/algorithm, sha256, signature, key fingerprint). Defense in depth.
- **Identity**: authors register public keys with the registry (GitHub OAuth
  account) so signatures can be attributed; fingerprints surface via
  `agent verify`.

## Consequences

- Archives that are tampered with, renamed, or re-versioned fail verification.
- The payload format is a cross-language contract — TS (`sdk`) and Python
  (`registry/app/security.py`) must stay in sync; tests exist on both sides.
- Trust in *identity* (who signed) is separate from trust in *isolation*
  (how it runs); see ADR-0004.

## Alternatives considered

- PGP → heavy, poor cross-platform UX.
- Package-manager-native checksums only → no identity, no authorship.
