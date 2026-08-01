# Website — Next.js

`web/` — the registry website. Next.js 15, App Router, TypeScript. Reads the
registry API directly; it has no backend of its own.

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
├── next.config.mjs        outputFileTracingRoot set to monorepo root
├── package.json           next 15, react, typescript
└── src/
    ├── lib/api.ts         registry API client + types (AgentSummary, AgentVersionDetail)
    ├── components/
    │   └── install.tsx      copy-to-clipboard install command snippet
    └── app/
        ├── layout.tsx       root layout, metadata
        ├── globals.css      design tokens + page styles
        ├── page.tsx         home: hero + search + latest agents grid
        ├── agent-card.tsx   grid card used on home
        └── agents/[namespace]/[name]/page.tsx   detail page
```

## Pages

### Home (`/`)

- Hero + search input (routes to `/?q=...`, triggers `searchAgents`).
- Grid of agents via `agent-card.tsx` (name, description, downloads, version,
  security/trust status).

### Detail (`/agents/[namespace]/[name]`)

- Header: name, description, author, license, trust/security status.
- Install command snippet with a copy button (`components/install.tsx`).
- Manifest rendering, security findings, signature info (publicKeyId, sha256),
  and download count from `AgentVersionDetail`.

## Data fetching

`src/lib/api.ts`:

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

## Conventions

- `@/` path alias → `web/src` (`tsconfig.json`).
- Plain CSS in `globals.css` (no Tailwind dependency).
- Registry must be reachable at build/request time for pages to render.
