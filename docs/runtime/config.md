# Runtime — Config & paths

`src/config.ts`, `src/permissions.ts`

## Constants (`config.ts`)

```ts
AGENT_HOME          // env AGENT_HOME, else ~/.openagenthub
AGENTS_DIR          // $AGENT_HOME/agents
CONFIG_PATH         // $AGENT_HOME/config.json
KEYS_DIR            // $AGENT_HOME/keys
SECRETS_DIR         // $AGENT_HOME/secrets
MASTER_KEY_PATH     // $AGENT_HOME/master.key
REGISTRY_DEFAULT    // https://registry.openagenthub.dev
```

## Agent key

```ts
interface AgentKey { namespace: string; name: string; version: string }
agentKeyToString(k)   // "namespace/name@version"
installedAgentDir(k)  // $AGENT_HOME/agents/{namespace}/{name}/{version}/
```

`installedAgentDir` is the canonical on-disk layout for an installed agent.

## config.json

Read/written by `loadConfig()` / `saveConfig()` (in `permissions.ts`; mode
`0o600`):

```json
{
  "registryUrl": "https://registry.openagenthub.dev",
  "token": "<registry bearer token>",
  "installed": {
    "ns/name@1.0.0": {
      "name": "name",
      "namespace": "ns",
      "version": "1.0.0",
      "author": "someone",
      "trust": "unknown",
      "installedAt": "2026-07-30T12:00:00.000Z",
      "source": "https://registry.../archive",
      "signatureKeyId": "<16-hex>"
    }
  },
  "permissions": {
    "ns/name@1.0.0": { "network": true }
  }
}
```

Helpers:

```ts
loadConfig(): OpenAgentHubConfig                     // {} if missing/corrupt
saveConfig(config): void
recordInstall(config, agent): void                   // writes installed[key]
grantedPermissions(config, agentKey): GrantedPermissions
saveGrantedPermissions(config, agentKey, perms): void
requestedPermissions(manifest): Permission[]          // manifest.permissions, or ["none"]
networkGranted(perms): boolean
```

Note: `trust` values are `"trusted" | "untrusted" | "unknown" | "local"`.
Registry installs yield `unknown`/`untrusted`; local dir installs yield
`local`.
