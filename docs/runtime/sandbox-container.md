# Runtime — Container sandbox

`src/sandbox/container.ts`

The hardened default for **unknown**/**untrusted** agents. Runs the agent in a
throwaway Docker container with minimal privileges.

## Base images

```ts
const IMAGE_TAGS = { python: "python:3.12-slim", node: "node:22-bookworm-slim", other: "python:3.12-slim" };
```

Chosen by `manifest.runtime.language`. Images are **digest-pinned** when the
`OPENAGENTHUB_IMAGE_DIGEST_PYTHON` / `OPENAGENTHUB_IMAGE_DIGEST_NODE` env vars
are set (`resolveImage` returns `tag@digest`); the human-readable tag is kept
for diagnostics. Pull failures fail closed with the reason.

## Hardening flags (the important part)

`baseFlags()` returns:

| Flag / option | Value | Why |
| --- | --- | --- |
| `--rm` | — | container cleaned up after exit |
| `--cap-drop` | `ALL` | no Linux capabilities |
| `--security-opt` | `no-new-privileges` | no privilege escalation |
| `--pids-limit` | `256` | cap process count |
| `--memory` | `512m` | cap memory |
| `--cpus` | `1` | cap CPU |
| `--user` | `10001:10001` | run as low-privilege uid/gid |
| `--network` | `none` unless `network` granted → `host` | network gate |
| `--tmpfs` | `/work:rw,size=64m` when `filesystem` granted | writable scratch |
| `--read-only` + `--tmpfs /tmp:rw,size=32m` | otherwise | read-only root + small tmp |
| `--volume` | `oah-deps-<hash>:/deps` | persistent dependency cache volume |
| `--label` | `oah.manager`, `oah.package`, `oah.version`, `oah.run_id`, `oah.digest`, `oah.sandbox` | managed-container identity |

No Docker socket, host devices, or broad host directories are ever mounted by
default — only `agentDir:/app:ro` plus the dependency volume.

Secrets (env values whose names match `/SECRET|TOKEN|KEY|PASSWORD/i`) are
written to a private `0600` env-file in a temp dir and passed via `--env-file`;
they are never visible in the `docker` command line. The temp dir is removed
after the run.

Plus, in `buildRunArgs`:

- **`--interactive`** — **required**. Without it, piped stdin never reaches
  the agent and `json.load` crashes on empty stdin. Hard-won gotcha; do not
  remove.
- Image + `/bin/sh -c <command>`, where the command is wrapped as:
  `set -e; export PYTHONPATH=/deps (or NODE_PATH=/deps/node_modules); cd /app && <command>`.

Dependency volumes are named deterministically from
`sha256("ns/name@version").slice(0,12)` (slugified) — `oah-deps-<hash>` — so
installed deps are reused across runs.

## Availability

`dockerAvailable()` probes `docker version --format {{.Server.Version}}`
(10s timeout). If docker isn't available, the runtime **fails closed** — it
never silently falls back to the process path. The CLI surfaces a clear
message that Docker is required (or to install from a local dir).

## run(opts)

Same `RunOptions`/`RunResult` contract as the process sandbox:

- `spawn("docker", args, { stdio: ["pipe","pipe","pipe"] })`.
- Writes `input` to stdin; collects container stdout/stderr; maps the
  container exit code.
- On `timeoutMs`, kills the container and sets `timedOut`.
- Captured output is bounded at 1 MiB per stream; excess is truncated with a
  note.
- Failed image pulls and dependency installs clean up the created dependency
  volume before raising.

`runInteractive` (MCP) uses `stdio: "inherit"`.

## Effective sandbox decision

`sandbox/policy.ts` derives the final sandbox at run time, in order:

1. **Revocation/quarantine first** — a `rejected`/`revoked` version cannot run.
2. **Source trust** — `untrusted`/`unknown` agents always run in a container,
   regardless of manifest preference or overrides.
3. **Review status** — non-verified status with stale/unfresh status forces
   container isolation.
4. **Local override** — digest-bound `container`/`process` override from
   `openagenthub sandbox set` (process requires `--acknowledge-risk`, only for
   trusted/local agents; a stale digest resets the override to container).
5. **Manifest preference** — `container` can be forced; `isolated-process` is
   honored only for trusted/local agents.
6. **Default** — trusted/local agents use the fast process path.

`openagenthub sandbox show ns/name` displays each factor and the effective sandbox.
Container-required-but-docker-missing fails closed with install guidance
(`dockerInstallHint`).

## Gotchas

- `--interactive` is non-negotiable (stdin piping).
- The docker argv is built in `buildRunArgs` and passed directly to `spawn` —
  no shell string at the Node layer; the `/bin/sh -c` wrapping lives in
  `resolveCommand`.
- `runtime.ts` constructs `ContainerSandbox` when `decideSandbox` returns
  `mode: "container"`; the sandbox guards trust itself (`ProcessSandbox`).

## Testing

Container argv construction (flags, network gate, tmpfs, image selection) is
covered in `runtime/test/runtime.test.ts` ("container sandbox security flags")
with a mocked `docker`. Real container execution is skipped when docker isn't
present.
