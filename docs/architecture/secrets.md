# Secrets Vault

`runtime/src/secrets.ts` — a machine-bound encrypted vault for agent secret
environment variables (API keys, tokens).

## Design

- **Storage**: one JSON file per agent under `$AGENT_HOME/secrets/`, named by
  the first 32 hex chars of `sha256(agentKey)` where `agentKey` is
  `namespace/name@version`.
- **Encryption**: AES-256-GCM. Each blob is JSON:
  `{ v: 1, iv, tag, data }` (iv 12 bytes, tag 16 bytes, all base64).
- **Key**: 32 random bytes at `$AGENT_HOME/master.key` (hex, mode `0o600`),
  generated on first open if absent.
- **Machine binding**: `deriveKey(passphrase)` uses
  `salt = sha256("openagenthub:v1:" + machineId())` via `scryptSync`.
  `machineId()` reads `/etc/machine-id`, then `/var/lib/dbus/machine-id`,
  then falls back to `"default-machine"`. Overridable with `AGENT_MACHINE_ID`
  (used by tests for determinism).

## Key API

```ts
class SecretsVault {
  static open(opts?: { dir?: string; passphrase?: string }): SecretsVault;
  has(agentKey: string): boolean;
  get(agentKey: string): Record<string, string>;   // {} if missing/corrupt
  set(agentKey: string, values: Record<string, string>): void;  // merges; "" deletes
  delete(agentKey: string): void;
  list(): string[];
}
```

`SecretsVault.open({ passphrase })` lets tests supply a fixed passphrase so
the derived key is deterministic across runs (see `runtime/test/secrets.test.ts`).

## Invariants

- **Never store secret values in manifests, code, or git.** They exist only in
  the vault and are injected as environment variables at run time.
- A corrupt vault file yields `{}` (get never throws).
- `set` merges over the existing blob and writes atomically (mode `0o600`).
- `agent uninstall` deletes the agent's vault entry explicitly; reinstalling
  an agent keeps its vault entry (same `namespace/name@version` key).

## Environment overrides

At run time (`runtime/src/runtime.ts`), env is built in this order (last wins):

1. `buildAgentEnv(model, ...)` — model vars + the provider's native key env.
2. Vault secrets for the agent key.
3. `extraSecrets` passed to `runAgent` (not currently exposed by the CLI).
4. `AGENT_TRUST`, `AGENT_HOME` (the agent dir), `AGENT_GRANTED_PERMISSIONS`.

The CLI manages the vault via `agent env ns/name KEY=VALUE` (values never
echoed) and can reveal one with `--reveal`.
