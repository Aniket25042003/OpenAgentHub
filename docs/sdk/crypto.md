# SDK — Crypto

`src/crypto.ts`

## Keys

- Ed25519 keypair via Node's `generateKeyPairSync("ed25519")`.
- Public key: PEM (SPKI).
- Private key: PEM (PKCS#8).

```ts
generateKeyPair(): { publicKey: string; privateKey: string }
```

## Signing

```ts
signPayload(payload: string, privateKeyPem: string): string   // base64
verifyPayload(payload: string, signatureB64: string, publicKeyPem: string): boolean
```

- The signature is **base64**.
- Consumers in other languages (the Python registry) must `base64.b64decode`;
  `bytes.fromhex` will fail — this was a real production bug.

## Fingerprint

```ts
publicKeyFingerprint(publicKeyPem: string): string
```

First 16 hex chars of `sha256(SPKI DER bytes)`. Used as the `publicKeyId` in
signature files and registered with the registry so publishes can be
attributed.

## What is signed

The signed payload is always the literal string (see `sdk/src/package.ts`):

```
openagenthub-signature-v1:<name>@<version>:<sha256>
```

- `<name>` is the full `namespace/name` from the manifest.
- `<sha256>` is the lowercase hex digest of the **archive bytes** (`archive.ahb`
  on disk).
- The registry mirrors this in `app/security.py` — keep both in sync.

## Verifying a full signature file

Higher-level helpers live in `src/package.ts`:

```ts
verifySignatureFile(sig: SignatureFile, archivePath): boolean            // soft
verifySignatureFileStrict(sig: SignatureFile, archivePath): void         // throws SignatureError
```

`verifySignatureFileStrict` checks, in order:

1. `sig.schemaVersion === 1` and `sig.algorithm === "ed25519"`.
2. sha256 of the archive bytes equals `sig.sha256` (checksum mismatch error).
3. `verifyPayload(signaturePayload(sig.name, sig.version, sig.sha256), sig.signature, sig.publicKey)`.
4. `publicKeyFingerprint(sig.publicKey) === sig.publicKeyId`.

Any failure throws `SignatureError` with a readable message.
