# SDK — Packaging (pack / unpack)

`src/package.ts`

## Signature file format

`SIGNATURE_FILENAME = "signature.sig.json"`, but `packAgent` writes a
per-archive file named `<name>_<version>.ahb.sig.json`:

```json
{
  "schemaVersion": 1,
  "algorithm": "ed25519",
  "publicKey": "<PEM SPKI>",
  "publicKeyId": "<16-hex fingerprint>",
  "sha256": "<hex>",
  "name": "namespace/name",
  "version": "1.0.0",
  "signature": "<base64>"
}
```

The registry's `SignatureFile` Pydantic model mirrors these exact fields.

## `packAgent`

```ts
packAgent(
  projectDir: string,
  opts: { privateKeyPem: string; outDir?: string },
): PackResult   // { manifest, archivePath, signaturePath, sha256, signature }
```

Steps:

1. `loadManifestFromDir(projectDir)` — validates first.
2. Collects files via `listProjectFiles`, excluding `IGNORE_PATTERNS`:
   `.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`,
   `dist`, `coverage`, `.DS_Store`, `*.ahb`, `*.sig.json`.
3. Shells out to system `tar` (`tar -czf <out> --exclude=.git <ignore args> <files>`),
   with `COPYFILE_DISABLE=1` set so macOS BSD tar doesn't emit AppleDouble
   `._*` companion files.
4. Computes `sha256` of the archive bytes.
5. Signs `openagenthub-signature-v1:<name>@<version>:<sha256>` and writes the
   signature file.

Output naming: `<name>_<version>.ahb` (the `/` in the name becomes `_`) plus
`<name>_<version>.ahb.sig.json`, in `outDir` (default: the project dir).

### AppleDouble files (macOS gotcha)

Two layers of protection:

- `COPYFILE_DISABLE=1` in the tar env.
- `listProjectFiles` skips any file whose basename starts with `._`.

Do not remove either layer. Without them `._agent.yaml` sneaks into archives,
which breaks the registry's exact-basename manifest check and pollutes
installs.

## `unpackAgent`

```ts
unpackAgent(archivePath, { destDir, limits? }): Promise<UnpackResult>
// UnpackResult = { manifest: Manifest, files: string[] }
```

Single-pass strict extractor (`extractArchive`). Rejects a member when:

- path is empty or contains a NUL byte;
- path is absolute, starts with `\`, or is a drive-letter path;
- any path segment is `..` (path traversal);
- the resolved path escapes `destRoot`;
- entry type is anything other than **File** or **Directory** (no symlinks,
  hardlinks, devices, FIFOs).

Limits (`DEFAULT_UNPACK_LIMITS`):

- `maxTotalBytes: 200 MiB`
- `maxSingleFileBytes: 50 MiB`
- `maxFiles: 5000`

File modes are sanitized (`& 0o777`, no setuid/setgid/sticky) and files are
written with `flags: "wx"` (fail if exists).

After extraction, requires `agent.yaml` or `manifest.yaml` at the root and
validates it (throws if missing or invalid).

## Errors

- `ArchiveError` — archive/hygiene failures.
- `SignatureError` — signature/checksum failures.

## Testing

`test/package.test.ts` covers: pack→unpack round-trip, `._*` exclusion,
path-traversal rejection, symlink rejection, size caps, and
`verifySignatureFileStrict` success + tamper cases.
