# SDK — Registry client

`src/registry.ts`

The SDK's HTTP client. It defines the **wire contract** the FastAPI registry
implements (see [registry/api.md](../registry/api.md)) — keep the two in
lockstep.

## Constructor

```ts
new RegistryClient(baseUrl: string, token?: string)
```

- `baseUrl` and `token` are passed in explicitly; the client does **not** read
  `config.json` itself. The CLI resolves them:
  `registryUrl ?? config.registryUrl ?? REGISTRY_DEFAULT` and `config.token`.
- Bearer auth header is added only when a token is present.

## Methods

```ts
search(opts: SearchOptions): Promise<AgentSummary[]>
// GET /api/v1/agents?q=&framework=&tags=&models=&sort=&limit=&offset=
// opts: { q?, framework?, tags?, models?, sort? ("downloads"|"trending"|"newest"), limit?, offset? }
// Response shape: { items: AgentSummary[] }

get(namespace, name): Promise<AgentSummary>
// GET /api/v1/agents/{namespace}/{name}

getVersion(namespace, name, version): Promise<AgentVersionDetail>
// GET /api/v1/agents/{namespace}/{name}/versions/{version}
// version="latest" is resolved server-side to the highest published version.

listVersions(namespace, name): Promise<string[]>
// GET /api/v1/agents/{namespace}/{name}/versions  → { versions: string[] }

downloadArchive(namespace, name, version): Promise<{ buffer: Buffer; sha256: string; signature: SignatureFile }>
// GET .../versions/{version}/archive
// Fetches the detail first (for its signature), then the archive bytes into
// memory; sha256 comes from the signature file. Caps download at 250 MiB (413).

publish(namespace, name, version, archive: Buffer, signature: SignatureFile): Promise<void>
// PUT /api/v1/agents/{namespace}/{name}/versions/{version}
// multipart/form-data: "archive" (file, <name>-<version>.ahb),
//                      "signature" (file, JSON.stringify(signature), signature.sig.json)

triggerScan(namespace, name, version): Promise<void>
// POST .../versions/{version}/scan  (re-runs the static safety scan)

me(): Promise<{ username: string; publicKeys: { id: string }[] }>
// GET /api/v1/me

uploadPublicKey(publicKeyPem): Promise<void>
// POST /api/v1/keys  { "publicKey": "<PEM>" }

exchangeGitHubToken(code): Promise<{ token: string }>
// POST /api/v1/auth/github  { "code": "..." }
```

## Types

```ts
interface AgentSummary {
  namespace: string; name: string; version: string; author: string;
  description: string; license: string; framework?: string;
  models: string[]; tags: string[]; downloads: number;
  trust: "trusted" | "untrusted" | "unknown";
}

interface AgentVersionDetail {
  name: string;               // "namespace/name"
  version: string; author: string; description: string;
  manifest: Manifest;         // the full manifest object
  publishedAt: string; downloadCount: number;
  trust: "trusted" | "untrusted" | "unknown";
  signature?: SignatureFile;
  security?: SecurityReportSummary;   // { status: "clean"|"flagged"|"pending"|"failed", findings: string[] }
}
```

## Error handling

- Non-2xx → `RegistryError` (from `src/errors.ts`) with status and parsed
  `detail` (supports FastAPI's array `detail`).
- Network timeouts: 30s default, 60s for downloads, both aborted via
  `AbortController`.

## Notes

- The registry's `trust` values are effectively `"unknown"` (default) or
  `"untrusted"` (flagged archive); `"trusted"` is reserved for explicit local
  decisions.
- `version=latest` alias is implemented server-side and used by the CLI
  installer.
