# ADR-0005 — Secrets vault

**Status:** Accepted

## Context

Agents need API keys and tokens, but secrets must never live in manifests,
code, or git. We needed a local, per-machine, per-agent store that the runtime
can inject as environment variables.

## Decision

- **Vault**: one encrypted JSON file per agent under `$AGENT_HOME/secrets/`,
  named by `sha256(agentKey).slice(0,32)` + `.json`.
- **Cipher**: AES-256-GCM (12-byte IV, 16-byte tag), authenticated.
- **Key**: 32 random bytes in `$AGENT_HOME/master.key` (mode `0o600`),
  generated on first use.
- **Machine binding**: the derived key salts with `sha256("openagenthub:v1:" +
  machineId())`; `machineId()` from `/etc/machine-id` (or dbus fallback),
  overridable via `AGENT_MACHINE_ID` (used by tests).
- **API**: `SecretsVault.open({ dir?, passphrase? })`; `has/get/set/delete/list`.
  `set` merges; empty string deletes a key. Corrupt/missing files read as `{}`.
- **Injection**: at run time, `buildAgentEnv` merges vault values into the
  agent's environment; explicit env vars win over the vault.

## Consequences

- Vaults are not portable between machines by design (machine-bound).
- Tests can pass a fixed passphrase for deterministic keys.
- Reinstall preserves secrets (agent key identity is unchanged).

## Alternatives considered

- Plaintext config → unacceptable for tokens.
- OS keychain → not portable across CI/headless, harder to test.
- Encrypted env files → no per-agent granularity, easy to leak.
