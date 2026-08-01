# Runtime — `@openagenthub/runtime`

The execution engine. Owns local config, the secrets vault, model selection,
granted permissions, and the two sandboxes (process + container). Imported by
the CLI (`cli/src/commands/run.ts`) and usable directly.

## Modules

| File | Purpose |
| --- | --- |
| `src/config.ts` | Paths, `AGENT_HOME`, default registry URL, `AgentKey`, `installedAgentDir` |
| `src/secrets.ts` | AES-256-GCM machine-bound vault (`SecretsVault`) |
| `src/models.ts` | `pickModel`, `buildAgentEnv` — provider/model/key resolution + env |
| `src/permissions.ts` | Config load/save + granted-permission helpers (`loadConfig`, `saveConfig`, `recordInstall`, `grantedPermissions`, ...) |
| `src/runtime.ts` | `AgentRuntime` — the orchestrator (`runAgent`) |
| `src/sandbox/process.ts` | `ProcessSandbox` (trusted/local path) |
| `src/sandbox/container.ts` | `ContainerSandbox` (hardened docker) |
| `src/sandbox/types.ts` | `Sandbox`, `RunOptions`, `RunResult`, `SandboxSpec` |

## Agent home layout

```
$AGENT_HOME/            (~/.openagenthub, or AGENT_HOME env)
├── agents/ns/name/version/   installed agents (+ signature.sig.json, archive.ahb)
├── keys/                      signing keypair (id_ed25519, id_ed25519.pub)
├── secrets/                   vault blobs (one .json per agent key)
├── config.json                CLI config (registryUrl, token, installed, permissions)
└── master.key                 vault master key (0o600)
```

## Usage

```ts
import { AgentRuntime } from "@openagenthub/runtime";
import { SecretsVault } from "@openagenthub/runtime";

const vault = SecretsVault.open();
const rt = new AgentRuntime(vault);
const res = await rt.runAgent({
  agentDir: "/path/to/installed/agent",
  manifest,                 // loaded via SDK loadManifestFromDir
  agentKey: "ns/name@1.0.0",
  interfaceName: "cli",
  input: JSON.stringify({ prompt: "hi" }),
  granted: ["network"],     // permission strings, only the granted ones
  trustLevel: "unknown",
  model: "openai",
  timeoutMs: 120_000,
});
console.log(res.result.stdout);
```

See [execution.md](../architecture/execution.md) for the step-by-step flow.

## Testing

`node --test "test/*.test.ts"` from `runtime/`. 20 tests across
`test/runtime.test.ts`, `test/models.test.ts`, `test/secrets.test.ts`:
secrets vault round-trips + passphrase determinism, model selection + key
precedence, config load/save, permission helpers, and process-sandbox run
semantics (env injection, exit codes, shell-metachar rejection, untrusted
refusal). Container sandbox argv construction is tested with a mocked docker
(`runtime.test.ts`); real docker runs are skipped when docker isn't available.
