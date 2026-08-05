# Packaging, Signing, and Verification

How an agent directory becomes a signed `.ahb` archive and back.

## Format

- **Archive**: gzip-compressed tar (`.ahb`), named `<name>_<version>.ahb`
  (the `/` in `namespace/name` becomes `_`).
- **Signature file**: `<name>_<version>.ahb.sig.json` — JSON with the Ed25519
  public key, sha256, and base64 signature (see
  [sdk/package.md](../sdk/package.md) for the exact shape).
- **Signed payload** (`sdk/src/package.ts` `signaturePayload`): the literal
  string `openagenthub-signature-v1:<name>@<version>:<sha256>` where `<sha256>`
  is the hex digest of the archive **bytes** as stored on disk.

## Signing (`sdk/src/crypto.ts`)

```ts
generateKeyPair(): { publicKey: string; privateKey: string }
signPayload(payload, privateKeyPem): string          // base64
verifyPayload(payload, signatureB64, publicKeyPem): boolean
publicKeyFingerprint(publicKeyPem): string           // sha256(SPKI DER)[:16]
```

- Ed25519; signatures are **base64** strings.
- **Never `bytes.fromhex` the signature** — the Python registry and test
  helpers must `base64.b64decode` (a real bug we hit).
- Private keys are PEM (PKCS#8) stored at `$AGENT_HOME/keys/id_ed25519`
  (mode `0o600`); publish generates one on first use.

## Packing (`sdk/src/package.ts` `packAgent`)

1. `loadManifestFromDir(projectDir)` — validates first.
2. Collect files via `listProjectFiles`, excluding `IGNORE_PATTERNS`
   (`node_modules`, `.venv`, `__pycache__`, `dist`, `*.ahb`, `*.sig.json`,
   `.git`, `.DS_Store`, ...).
3. Shell out to system `tar` with `COPYFILE_DISABLE=1`.
4. `sha256` the archive; sign the payload; write `.ahb` + `.sig.json`.

### macOS AppleDouble gotcha

BSD `tar` on macOS emits `._*` resource-fork companion files. Two layers of
protection:

- `COPYFILE_DISABLE=1` is set in the pack env.
- `listProjectFiles` skips any file whose basename starts with `._`.

Without both, `._agent.yaml` sneaks into archives, which broke the registry's
manifest check. Do not "simplify" this away.

## Unpacking (`unpackAgent`)

Strict, single-pass. Rejects any member that:

- has an empty path or NUL byte;
- is absolute / backslash-prefixed / a drive-letter path;
- contains a `..` segment or escapes the destination;
- is anything but a regular File or Directory (no symlinks, hardlinks,
  devices);
- exceeds caps: 200 MiB total, 50 MiB per file, 5000 files.

Requires `agent.yaml` or `manifest.yaml` at the root and validates it.

## Verification flow

| Stage | What is checked | Where |
| --- | --- | --- |
| Publish | sha256 + Ed25519 sig over `openagenthub-signature-v1:<name>@<version>:<sha256>`; sig.name/version match route; manifest matches sig | `registry/app/crypto.py` `verify_signature` |
| Install | `verifySignatureFileStrict` on the downloaded archive: schema/algorithm, sha256, signature, public-key fingerprint | `cli/src/lib/installer.ts` via `sdk` |

The client also re-unpacks strictly, so a hostile archive flagged or missed by
the registry scan is still rejected at install.

## Versioning

Versions are SemVer (`^0|[1-9]\d*\.\d+\.\d+...$`). The registry aliases
`version=latest` to the most recently published version (ordered by
`published_at`); the CLI resolves it server-side via `getVersion(..., "latest")`.
