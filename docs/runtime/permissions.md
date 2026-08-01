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
networkGranted(perms): boolean                 // perms.network === true
grantedPermissions(config, agentKey): GrantedPermissions
```

## Enforcement points

1. **Container path** (`sandbox/container.ts`): `--network none` unless
   `network` is granted (then `--network host`); a writable `/work` tmpfs only
   when `filesystem` is granted, otherwise `--read-only` + `/tmp` tmpfs.
2. **Process path** (`sandbox/process.ts`): dependency install (`pip`/`npm`)
   is rejected unless `network` is granted.
3. **Env**: the runtime sets `AGENT_GRANTED_PERMISSIONS` to the granted
   comma-joined list, `AGENT_TRUST` to the trust level, and `AGENT_HOME` to the
   agent dir — the agent can introspect these.

## Invariant

The runtime only ever receives the *granted* set (intersected at install
time), so an agent can never exceed what the user approved. The sandbox flags
are derived directly from that granted set.
