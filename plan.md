# OpenAgentHub — Secure One-Package Product Plan (v7)

Steering plan for the next product cycle. This file is the **driver**: what to build,
in what order, under which principles. Detailed **how-to** for each milestone lives in
[`plans/`](plans/).

| Role | File |
| --- | --- |
| Driver (this file) | [`plan.md`](plan.md) |
| Architecture + data models | [`plans/architecture.md`](plans/architecture.md) |
| Milestone how-to | [`plans/m0-…`](plans/) through [`plans/m8-…`](plans/) |

There are **nine** milestones (**M-0 through M-8**). Implement them in order unless a
milestone file explicitly allows parallel work after its prerequisites.

---

## Agent operating instructions

Follow these rules when implementing from this plan:

1. **Read this file first**, then open **only the current milestone file** under
   [`plans/`](plans/). Do not load every milestone file at once.
2. Treat [`plans/architecture.md`](plans/architecture.md) as binding for module
   boundaries, API contracts, workers, and data models.
3. **One milestone at a time.** Do not start M-N+1 until M-N’s verification gate
   passes (or an explicit, documented exception is approved).
4. Prefer the **suggested branch/PR splits** inside each milestone file. Never open
   one giant PR covering multiple milestones.
5. Obey **GitHub commits & PR principles** (below) for every change.
6. If a detail in a milestone file conflicts with this driver or architecture, prefer
   this driver + architecture and note the conflict in the PR.
7. Do not invent scope from “nice to have.” If it is not in the milestone file or
   this driver, it is out of scope for that PR.
8. Keep the monorepo invariants in [`AGENTS.md`](AGENTS.md) (manifest as contract,
   schema lockstep, Ed25519, sandbox trust model, no secrets in repos).

---

## Product goals

1. One install (npm now; Homebrew/signed binaries later) with a consistent CLI.
2. Search, install, run, stop, inspect, and update agents safely.
3. Registry agents run in Docker by default unless the user sets an explicit
   digest-scoped host override.
4. Bundle CLI + local control plane + dashboard in one package.
5. Docker-like run lifecycle and durable local run history.
6. Local status, uptime, tokens, cost, and limits — no prompts/source collection.
7. Anonymous public browse/install; authenticated publishers for uploads.
8. Separate publisher identity, package ownership, scan status, manual verification,
   and local sandbox policy.
9. Registry stays responsive under catalog/search/download/publish abuse.
10. One hosted web account for publisher/org/private/admin workflows without forcing
    consumer login for public agents.
11. Private/internal agent packages without automatically uploading machine data.

---

## Security principles (non-negotiable)

- Auth proves who is acting; it does not prove code is safe.
- Authorization decides who may mutate namespaces/packages.
- Publisher verification ≠ package-version verification ≠ host execution.
- Manual verification is per **immutable version + archive digest**.
- Do not store registry trust and local sandbox preference as one mutable `trusted`
  flag.
- Manifests may request stronger isolation, never weaker than platform policy.
- Containers reduce risk; they are not a guarantee. Secrets + network remain risky.
- Rejected/revoked/flagged versions blocked by default.
- Security decisions visible in CLI/dashboard and audited.
- Public endpoints assume abuse and hostile uploads.

---

## Architecture (summary)

**Modular monolith + independently deployed workers** — not premature microservices.

- One hosted FastAPI deployment; domain modules in-process (identity, orgs/authz,
  registry, security/review, quotas/billing, audit).
- Shared PostgreSQL with **module-owned tables/write paths**.
- Workers (scan, notifications, billing reconcile, maintenance) via **transactional
  outbox + durable queue**.
- CLI and hosted web are **API clients** (shared OpenAPI/TypeScript client). No
  direct DB access from clients.
- Hosted Next.js may be a thin **BFF** for cookies/CSRF only.
- Local product is **one modular control-plane process** (not local microservices).

Full diagram, module rules, worker model, extraction criteria, and data models:
[`plans/architecture.md`](plans/architecture.md).

---

## Decisions incorporated (short)

| Area | Decision |
| --- | --- |
| End users | Browse/install public agents without an account |
| Publishers | GitHub OAuth account + registered Ed25519 key; ownership on every publish |
| Web + CLI auth | Same OpenAgentHub account; separate browser sessions vs scoped CLI tokens |
| Verification | Per-version review status; new digests start pending/unverified |
| Sandbox | Container default; `allow-host` is digest-scoped override with confirmation |
| CLI name | Primary `openagenthub`; keep `agent` alias for one release |
| Daemon | No-arg opens dashboard; one-shots do not auto-open browser; `OPENAGENTHUB_NO_DAEMON=1` |
| Usage | First-party run store first; third-party local parse default; live APIs opt-in |
| Catalog | Marketing `/agents` fetches registry catalog; no bundled local catalog snapshot |
| Private packages | M-8: public/private/internal; not model-weight hosting |

---

## Open decisions (resolve before dependent milestone)

1. **Node floor before M-5** — bump for `node:sqlite` vs fallback/omit OpenCode DB.
2. **Publisher signup before M-0 done** — GitHub OAuth only for v1 (recommended).
3. **Windows autostart before M-2 done** — macOS/Linux first; Windows manual (recommended).
4. **Verified host default** — still container by default (assumed).
5. **Prod infra before M-6** — Redis-compatible cache + object storage/CDN.

---

## Milestone roadmap

| # | Milestone | Detail file | Prerequisite |
| --- | --- | --- | --- |
| M-0 | Security and correctness foundation | [plans/m0-security-and-correctness.md](plans/m0-security-and-correctness.md) | — |
| M-1 | Rename + one-package distribution | [plans/m1-one-package-distribution.md](plans/m1-one-package-distribution.md) | M-0 |
| M-2 | Local control plane + dashboard lifecycle | [plans/m2-local-control-plane.md](plans/m2-local-control-plane.md) | M-1 |
| M-3 | Agent lifecycle supervisor | [plans/m3-agent-supervisor.md](plans/m3-agent-supervisor.md) | M-2 |
| M-4 | First-party observability | [plans/m4-first-party-observability.md](plans/m4-first-party-observability.md) | M-3 |
| M-5 | Third-party usage + limits | [plans/m5-usage-and-limits.md](plans/m5-usage-and-limits.md) | M-4 |
| M-6 | Registry catalog + hardening | [plans/m6-registry-catalog-hardening.md](plans/m6-registry-catalog-hardening.md) | M-0 (can parallel after M-0) |
| M-7 | Shared web auth + publisher console | [plans/m7-shared-auth-and-publisher-console.md](plans/m7-shared-auth-and-publisher-console.md) | M-0 + M-6 |
| M-8 | Private registry + organizations | [plans/m8-private-registry-and-organizations.md](plans/m8-private-registry-and-organizations.md) | M-7 |

### Suggested branch sequence

1. `refactor/modular-api-foundation` — M-0.0
2. `security/publisher-ownership-and-keys` — M-0.1–M-0.3
3. `security/review-sandbox-permissions` — M-0.4–M-0.7
4. `fix/cli-runtime-correctness` — M-0.8
5. `feat/one-package-distribution` — M-1
6. `feat/local-control-plane` — M-2
7. `feat/agent-supervisor` — M-3
8. `feat/first-party-observability` — M-4
9. `feat/usage-limit-adapters` — M-5
10. `feat/registry-catalog-hardening` — M-6
11. `feat/shared-web-auth` — M-7.1–M-7.2
12. `feat/publisher-admin-catalog` — M-7.3–M-7.6
13. `feat/private-registry-organizations` — M-8.1–M-8.6
14. `feat/private-access-audit-quotas` — M-8.7–M-8.9
15. `feat/billing-device-foundation` — M-8.10–M-8.11

PR #5 (`feat/checkpoint-redesign`) stays separate until marketing/catalog UI direction
is reconciled. Each branch starts from updated `main` after its dependencies merge.

---

## GitHub commits and PR principles

Agents and humans must version work so reviews stay small and history stays useful.

### Branches

- Branch from latest `main` (or the documented dependency branch).
- Name: `type/short-kebab-topic` (`feat/`, `fix/`, `security/`, `refactor/`, `docs/`,
  `test/`).
- One branch ≈ one PR ≈ one milestone subsection (e.g. M-0.1–M-0.3), not an entire
  M-0…M-8 epic.
- Do not commit secrets, `.env`, private keys, or vault material.
- Do not force-push `main`. Avoid force-push on shared PR branches unless required
  after explicit review agreement.
- Do not use `--no-verify` / skip hooks unless the user explicitly requests it.

### Commits

- Commit when a coherent unit is done (buildable, tests for that unit green when
  practical) — not one mega-commit at the end of a milestone.
- Message style: short imperative summary focusing on **why**, then optional body.
  Examples:
  - `fix: enforce package ownership on every publish`
  - `feat: add transactional outbox for scan jobs`
  - `refactor: extract identity module boundaries in registry`
- Prefer focused commits: do not mix unrelated refactors with feature work.
- If a pre-commit hook fails, fix and create a **new** commit (do not amend pushed
  history unless the user explicitly asks and amend rules are met).
- Never rewrite shared history casually; never amend commits you did not create in
  this session unless the user requests it and amend safety rules are satisfied.

### Pull requests

- Open a PR early when the branch has a clear purpose; keep it reviewable
  (prefer <~400–800 changed lines when possible; split if larger).
- Title: concise, matches branch intent (e.g. `M-0.1–0.3: publisher ownership and keys`).
- Body must include:
  - **Summary** — 1–3 bullets of what and why.
  - **Milestone** — e.g. `plans/m0-security-and-correctness.md` § M-0.1–M-0.3.
  - **Test plan** — checklist of commands/cases run or still TODO.
  - **Risk / rollout** — migrations, breaking CLI changes, feature flags.
- Link related issues/PRs. Call out schema/API/contract changes explicitly.
- Request review before merging. Address review comments with new commits or clear
  replies; do not silently drop feedback.
- When merging or closing a PR (or reviewing commits), leave a **detailed PR
  comment** explaining what was done and why (repo rule in [`AGENTS.md`](AGENTS.md)).
- CI must be green for required checks. Update e2e/docs in the same PR when behavior
  or user-facing commands change.
- Prefer merge (or repo-default strategy) over rewriting; do not squash away
  meaningful security review history without reason.

### Versioning and tags

- Follow existing package versions until a public breaking rename/release; bump
  workspace package versions when publishing artifacts.
- Breaking CLI/API changes require a clear migration note in the PR and docs.
- Do not publish npm/registry artifacts from a half-finished milestone branch.

---

## Explicitly out of scope (M-0–M-8)

- Consumer accounts required for public browse/install.
- Password auth while GitHub OAuth suffices for publishers.
- Claiming scans/admin review guarantee safety.
- Native tray app / embedded Docker VM.
- Auto agent-switching on remaining quota.
- Cross-machine usage sync; collecting prompts/responses/source.
- Automatic broad host filesystem access.
- Bundled full catalog in the npm package.
- Native model-weight hosting / training / GPU inference.
- Enterprise SAML SSO / SCIM.
- Remote shell / remote agent execution via enrolled devices.
- Storing card data (use hosted payment provider later).
- Windows autostart until explicitly chosen and tested.
- Premature network microservices that fail the extraction criteria in
  [`plans/architecture.md`](plans/architecture.md).

---

## Final release gate

Ship the secure one-package cycle only when:

- Hosted domains are modules in one FastAPI deployment; workers are outbox-backed and
  independently deployable.
- Web + CLI share one versioned API contract; no client DB access.
- No internal microservice without extraction criteria + owned contract/data.
- Publish requires auth + namespace authorization + registered active signing key.
- Cross-user takeover prevented; manifests/archives canonically validated.
- Verification is per digest and audited; unverified agents container by default.
- Host execution is digest-scoped and explicit; revoked versions blocked and surfaced.
- One install ships CLI + control plane + dashboard; runs have IDs/logs/history.
- First-party usage accurate; third-party live integrations opt-in.
- Catalog paginated/cacheable/rate-limited; public transparency without signup.
- Orgs can manage private packages, credentials, quotas, audits without cross-tenant
  leakage; device enrollment opt-in only.
- Adversarial, package, daemon, Docker e2e, registry, auth, private-authz, and
  workspace tests pass.

---

## Current foundation (do not regress)

Preserve: schema + SDK validation, Ed25519 pack/sign/verify, strict unpack, registry
read/publish APIs, GitHub OAuth exchange, container + process sandboxes, secrets
vault, CLI install/run flows, `systemSnapshot`, Next standalone dashboard, e2e happy
path.

Known gaps (fix in M-0): sandbox preference vs trust ordering; missing ownership
checks; unbound signing keys; no registry schema validation; structural-only scan;
permissions not re-enforced at run; flagged still installable; unauthenticated rescan.
