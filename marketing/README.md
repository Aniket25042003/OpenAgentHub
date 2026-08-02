# Marketing site — Next.js (static)

`marketing/` — the public marketing & landing website for OpenAgentHub. It is a
**standalone** project, fully separate from the dashboard that ships with the
package (`web/`): no registry, no runtime, no API. It is purely informational —
product pitch, features, how-it-works, and step-by-step install instructions
(npm / Homebrew / binary).

Shares the same modern light design language as the dashboard (same CSS design
tokens, `Inter` via `next/font`), but has its own stylesheet and components.

## Commands

```bash
npm run dev -w @openagenthub/marketing          # dev server on :3000
npm run build -w @openagenthub/marketing        # static export -> out/
npm run typecheck -w @openagenthub/marketing    # tsc --noEmit
npm run preview -w @openagenthub/marketing      # serve out/ on :4000
```

## How it's hosted

`next.config.mjs` sets `output: "export"`, so `npm run build` produces a fully
static `out/` directory with no server runtime. Host it anywhere that serves
static files (Nginx, GitHub Pages, S3, Netlify, Vercel, ...).

To preview locally after a build:

```bash
python3 -m http.server 4000 -d marketing/out
```

## Structure

```
marketing/
├── next.config.mjs        output: "export" (static site)
├── package.json           next 15, react, typescript (no runtime/sdk deps)
└── src/
    ├── app/
    │   ├── layout.tsx       root layout: header (sticky nav + CTAs) + footer
    │   ├── page.tsx         single landing page: hero, features, steps, install, CTA
    │   └── globals.css      light-theme design tokens + landing components
```

## Editing notes

- The install commands in the install section are the product's canonical
  channels. The GitHub URLs use the real repo
  (`https://github.com/Aniket25042003/OpenAgentHub`).
- Keep the design tokens in `globals.css` in sync with `web/src/app/globals.css`
  so the two sites look like one product.
- Fonts (`Inter`, `JetBrains Mono`) are self-hosted at build time via
  `next/font`; no runtime CDN dependency.
