# Website — Next.js

`web/` — the local **system dashboard** + registry website. Next.js 15, App
Router, TypeScript. The homepage is a live dashboard of agents/containers on
the machine (data via a local-only route handler); registry browsing/search
lives at `/browse` and reads the registry API.

## Commands

```bash
npm run build -w @openagenthub/web
cd web && npx next start -p 3100
# dev:
npm run dev -w @openagenthub/web
```

## Structure

```
web/
├── next.config.mjs        outputFileTracingRoot set to monorepo root;
│                          serverExternalPackages: @openagenthub/runtime, @openagenthub/sdk
├── package.json           next 15, react, typescript
└── src/
    ├── lib/api.ts         registry API client + types (AgentSummary, AgentVersionDetail)
    ├── components/
    │   ├── install.tsx      copy-to-clipboard install command snippet
    │   ├── site-nav.tsx     tabs: Dashboard (/), Browse (/browse)
    │   └── dashboard.tsx    "use client": polls /api/system, renders host/agents/containers
    └── app/
        ├── layout.tsx       root layout, metadata, SiteNav in header
        ├── globals.css      design tokens + nav/stats/table/section styles
        ├── page.tsx         home: <Dashboard />
        ├── api/system/route.ts   local-only snapshot endpoint (dynamic, calls systemSnapshot)
        ├── browse/page.tsx  registry search + latest agents grid
        ├── agent-card.tsx   grid card used on /browse
        └── agents/[namespace]/[name]/page.tsx   detail page
```

## Pages

### Dashboard (`/`)

- Host stats (OS, arch, CPU/memory, uptime, Docker server version).
- Installed OpenAgentHub agents (name, version, sandbox).
- Detected third-party agents (OpenClaw, Hermes, ...) matched by process/config/
  port via the runtime catalog (`@openagenthub/runtime` `systemSnapshot`).
- Docker containers, with `openagenthub/*` image flag.
- Polls `GET /api/system` every 8s (client component).

### Browse (`/browse`)

- Search input (routes to `/?q=...`, triggers `searchAgents`).
- Grid of agents via `agent-card.tsx` (name, description, downloads, version,
  security/trust status).

### Detail (`/agents/[namespace]/[name]`)

- Header: name, description, author, license, trust/security status.
- Install command snippet with a copy button (`components/install.tsx`).
- Manifest rendering, security findings, signature info (publicKeyId, sha256),
  and download count from `AgentVersionDetail`.

## Data fetching

`src/lib/api.ts` (registry — used by `/browse` and detail pages):

```ts
searchAgents(q?): Promise<AgentSummary[]>      // GET /api/v1/agents?q=&sort=downloads
getAgent(ns, name): Promise<AgentSummary>       // GET /api/v1/agents/{ns}/{name}
getAgentVersion(ns, name, version="latest")     // GET /api/v1/agents/.../versions/{version}
registryUrl(): string
```

- Base URL from `NEXT_PUBLIC_REGISTRY_URL` or default `http://localhost:8000`.
- Uses Next ISR: `request<T>(path, revalidate = 60)` → `{ next: { revalidate } }`.
- Types mirror `sdk/src/registry.ts` + `registry/app/schemas.py`; keep them in
  sync.

`src/app/api/system/route.ts` (dashboard — local only, no registry involved):

- `export const dynamic = "force-dynamic"` (no caching of machine state).
- Calls `systemSnapshot()` from `@openagenthub/runtime` and returns JSON.
- `@openagenthub/runtime` + `@openagenthub/sdk` are listed in
  `serverExternalPackages` so Next bundles them natively (no bundled copy).

## Conventions

- `@/` path alias → `web/src` (`tsconfig.json`).
- Plain CSS in `globals.css` (no Tailwind dependency).
- Registry must be reachable at build/request time for `/browse` and detail
  pages to render; the dashboard works without it.
