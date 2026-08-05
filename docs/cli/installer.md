# CLI — Installer

`cli/src/lib/installer.ts`

Shared install logic used by `agent install` and `agent update`. All the
safety-critical wiring lives here.

## Resolvers

```ts
parseSpec(spec): { namespace, name, version? }
// regex: ^([a-z0-9][a-z0-9-]*[a-z0-9])\/([a-z0-9][a-z0-9_-]*[a-z0-9])(?:@(.*))?$
```

`resolveFromRegistry(spec, registryUrl, token)`:

1. `RegistryClient.getVersion(ns, name, version ?? "latest")` → detail
   (`latest` resolves to the highest semver on the server, not the newest
   publish).
2. `downloadArchive(ns, name, detail.manifest.version)` → `{ buffer, sha256,
   signature }` (archive bytes in memory; sha256 comes from the signature).
3. Writes the buffer to a temp `.ahb`.
4. `verifySignatureFileStrict(signature, archivePath)` — throws `SignatureError`
   on any mismatch.
5. Blocks `rejected`/`revoked` review statuses with the registry's reason.
6. Trust = `"untrusted"` if `detail.security.status === "flagged"`, else
   `detail.trust ?? "unknown"`.

`resolveFromFile(archivePath)` — local `.ahb` + sibling `.sig.json`; verifies
the signature if present (missing/invalid signature is tolerated for file
installs → still `unknown`).

`resolveFromDir(dirPath)` — dev mode: `loadManifestFromDir`; trust `local`,
source `dir:<path>`.

## `installAgent(spec, source, opts)`

`opts: { forceYes, noPermissions, registryUrl?, force? }`.

1. Resolve (registry/file/dir) + registry URL (`opts.registryUrl ??
   config.registryUrl ?? REGISTRY_DEFAULT`).
2. **Name match check**: `manifest.name` must equal `namespace/name` from the
   spec → error otherwise.
3. **Reinstall guard**: if the exact `namespace/name@version` is already in
   `config.installed` and `opts.force` is unset, abort with
   `... is already installed (reinstall with: agent install ... --force)`.
   `agent update` and `agent install --force` bypass this.
4. Print trust + source; warn about container sandbox for unknown/untrusted.
5. `checkAgentRequirements(manifest, detectRuntime())` — warn on missing
   runtimes; confirm install anyway unless `--yes`.
6. Permission grant: `requestedPermissions(manifest)` → interactive
   `confirmAll` per permission (or `--yes` approves all / `--no-permissions`
   denies all). Stores granted map in `config.permissions[agentKey]`.
7. Install:
   - archive: `rmSync(dest)` then strict `unpackAgent(archive, { destDir })`;
     copies `signature.sig.json` + `archive.ahb` into the install dir.
   - dir: copies files via `listProjectFiles`.
8. `recordInstall(config, { namespace, name, version, author, trust,
   installedAt, source, signatureKeyId, reviewStatus, statusCheckedAt,
   archiveDigest })` → `config.installed[agentKey]`.

## Trust recording

Trust is stored **in `config.json`** (`installed[agentKey].trust`), not a
separate marker file. `agent run` reads it and passes it to the runtime, which
drives sandbox selection. There is no dedicated `agent trust` command — trust
comes from the install source (registry → unknown/untrusted, dir → local).

## Reinstall semantics

- Installing the same `namespace/name@version` again requires `--force`
  (reinstall guard); `agent update` always forces because it explicitly
  targets a new version.
- Multiple versions of an agent can be installed side by side. Commands that
  target an installed agent without an explicit `@version` resolve to the
  **highest semver** installed (see `cli/src/lib/resolve.ts`); `agent
  uninstall` without a version refuses when more than one version is
  installed.
- `agent update` resolves `latest` server-side (highest semver, not newest
  publish) and installs that version with the force flag.
- Vault secrets are keyed by `namespace/name@version`, so reinstalls keep
  them; `agent uninstall` deletes them explicitly.

## Failure policy

Any verification failure (bad sha256, bad signature, unsafe archive) aborts
before the install dir is touched. `unpackAgent` applies its own caps at
install time (200 MiB total / 50 MiB per file / 5000 files) — defense in depth
on top of the registry scan.
