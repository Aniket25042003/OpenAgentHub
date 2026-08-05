# Runtime — Permissions

Granted permissions come from `config.json` (`permissions[agentKey]`), set at
install time (see [cli/installer.md](../cli/installer.md)). The helper module
is `src/permissions.ts`; the *enforcement* happens in the sandboxes.

## Manifest capability enum

`manifest.permissions` (an **array**) may contain any of:

```
filesystem | network | github | terminal | browser | camera | microphone | none
```

`none` must not be combined with others.

## Grant model

- The manifest **declares** what the agent wants (the ceiling).
- At install, the user **grants** per permission: `--yes` approves all,
  `--no-permissions` denies all, otherwise an interactive prompt per
  permission.
- The grant is persisted as `GrantedPermissions` (`Record<permission, boolean>`)
  in `config.json`.
- At run time `agent run` reads `grantedPermissions(config, agentKey)` and
  passes only the granted permission names to `runAgent`.

Helpers:

```ts
requestedPermissions(manifest): Permission[]   // manifest.permissions ?? [], "none" short-circuits
effectivePermissions(manifest, saved): Permission[]  // saved ∩ manifest requests (drops "none")
unsupportedSavedGrants(manifest, saved): string[]    // saved grants absent from the manifest
networkGranted(perms): boolean                 // perms.network === true
grantedPermissions(config, agentKey): GrantedPermissions
```

## Enforcement points

1. **Effective set** — `runAgent` computes `effectivePermissions` (saved grants
   ∩ manifest requests) and **refuses to start** if any saved grant is absent
   from the manifest: tampered `config.json` grants cannot exceed the manifest.
2. **Container path** (`sandbox/container.ts`): `--network none` unless
   `network` is granted (then `--network host`); a writable `/work` tmpfs only
   when `filesystem` is granted, otherwise `--read-only` + `/tmp` tmpfs.
3. **Process path** (`sandbox/process.ts`): dependency install (`pip`/`npm`)
   is rejected unless `network` is granted.
4. **Env**: the runtime sets `AGENT_GRANTED_PERMISSIONS` to the *effective*
   comma-joined list, `AGENT_TRUST` to the trust level, and `AGENT_HOME` to the
   agent dir — the agent can introspect these.

## Secrets

- `manifest.secrets` lists env-var names the agent wants. `agent run` asks for
  each stored vault secret separately (`--allow-secrets` grants all without
  prompting; non-TTY runs skip un-granted secrets with a warning).
- Grants are persisted as `secretGrants[agentKey]` in `config.json`.
- Secret values only ever reach the agent as env vars; in the container path
  they go through a private `0600` env-file (`--env-file`), never the docker
  command line, logs, or dashboard responses.

## Invariant

The runtime only ever receives the *effective* set (saved ∩ manifest), so an
agent can never exceed what the user approved and tampering with saved grants
cannot escalate beyond the manifest ceiling. The sandbox flags are derived
directly from that effective set.
