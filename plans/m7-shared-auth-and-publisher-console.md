# M-7 — Shared web authentication, publisher console, admin review, and public transparency

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-6 complete for catalog; M-0 security model required.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `registry/app/`, `web/`, `marketing/`, `cli/src/commands/`, `sdk/src/registry.ts`.

## Suggested branches / PRs

- `feat/shared-web-auth` — M-7.1–M-7.2
- `feat/publisher-admin-catalog` — M-7.3–M-7.6

## Implementation plan

M-7 turns the existing registry authentication primitives into one coherent hosted
identity and management experience. Public browsing and installation remain
anonymous; authenticated web and CLI sessions represent the same OpenAgentHub
account.

Architecture alignment:

- Identity, session, publisher, review, and audit capabilities are modules in the
  hosted FastAPI deployment, not separate auth/admin microservices.
- The hosted Next.js server is a thin BFF for cookie/session mechanics and calls the
  shared API client.
- CLI device authorization calls the same identity module through public API
  contracts.
- Notifications and outbound webhooks are queued to independent workers after the
  authoritative transaction commits.
- UI components never duplicate authorization or verification state transitions.

### M-7.1 Shared identity and OAuth foundation

> **STATUS: DONE** — merged as part of `feat/shared-web-auth` (M-7.1+M-7.2).

1. Keep GitHub `github_id` as the stable external identity key rather than using a mutable GitHub username.
2. Add a hosted `Sign in with GitHub` flow using:
   - OAuth `state` validation;
   - PKCE where supported by the selected GitHub flow;
   - one-time authorization codes;
   - strict redirect URI allowlists;
   - short callback expiry;
   - protection against login CSRF and session fixation.
3. Exchange the GitHub authorization code only on the backend. Never expose the
   GitHub client secret or provider access token to browser JavaScript.
4. Store the minimum GitHub profile data needed for identity, verified-email checks,
   avatar display, and organization verification.
5. Request the smallest GitHub scopes possible. Do not request repository access for
   ordinary OpenAgentHub login.
6. Create secure server-side or opaque browser sessions with:
   - `HttpOnly`, `Secure`, and appropriate `SameSite` cookies;
   - session ID rotation after authentication and privilege changes;
   - bounded idle and absolute expiration;
   - logout and logout-all-devices;
   - server-side revocation;
   - device, creation time, last-used time, and approximate location metadata where
     privacy policy permits.
7. Add account pages for profile, linked identity, active sessions, account status,
   security events, and account deletion.
8. Prevent silent account merging based only on matching email addresses. Future
   identity linking requires reauthentication to both accounts.
9. Preserve anonymous public routes without creating shadow accounts or tracking
   identities unnecessarily.
10. Add explicit Terms of Service, privacy-policy acceptance version, and publisher
    agreement timestamps before first publish.

> **Implementation notes for M-7.1 (applies to M-7.1 only):** the plan's flow for
> "hosted web sign-in" is implemented in `registry/app/identity/oauth.py` (start +
> callback endpoints on `auth_router`), using HMAC-signed state tokens, a strict
> redirect allowlist (`settings.web_redirect_uris`), short code/state TTLs, and
> backend-only code exchange. Opaque server-side sessions live in
> `registry/app/identity/sessions.py` with bounded idle/absolute TTLs, rotation on
> use (for web sessions), revocation, and device/audience metadata. CLI credentials
> are stored in the machine-bound encrypted vault (not `config.json`). A TLS
> termination proxy (e.g. cloudflare/caddy) is expected in production; the built-in
> dev/test host uses HTTP-only cookies except when the request is already HTTPS.

### M-7.2 CLI browser/device authorization

> **STATUS: DONE** — merged as part of `feat/shared-web-auth` (M-7.1+M-7.2).

1. Replace the normal `openagenthub login --token` experience with
   `openagenthub login`.
2. Preferred flow:
   - CLI requests a short-lived device or login transaction;
   - browser opens the hosted GitHub authorization page;
   - user reviews requested OpenAgentHub scopes;
   - CLI polls with bounded backoff or receives a localhost callback;
   - registry returns an OpenAgentHub-issued credential, not the GitHub token.
3. Bind the transaction to a nonce, CLI client ID, redirect mode, requested scopes,
   registry origin, and short expiry.
4. Store CLI credentials in the encrypted vault rather than plain `config.json`.
5. Add:
   - `openagenthub whoami`;
   - `openagenthub logout`;
   - `openagenthub auth status`;
   - `openagenthub auth sessions`;
   - `openagenthub auth revoke <session-id>`.
6. Keep `openagenthub login --token` for CI or recovery, clearly labeling it as an
   advanced flow.
7. Issue separate token classes for interactive CLI sessions, API tokens, and
   service accounts so revoking one does not invalidate every access method.
8. Use short-lived access tokens and a revocable renewal mechanism. Do not rely on
   one unrotated seven-day bearer token as the final design.
9. Scope CLI credentials to the selected registry and prevent accidental credential
   forwarding to another registry URL.
10. Add tests for expired transactions, replay, wrong registry, denied consent,
    browser cancellation, polling abuse, and local callback port collision.

> **Not done for M-7.2 batch:** polling-abuse rate-limit test, local-callback
> port-collision test, and browser-cancellation/denied-consent UI states are
> deferred (CLI uses fixed-interval polling; the registry rejects
> expired/replayed `expired_token` transactions and returns `authorization_pending`
> until approval). PKCE is not needed because the GitHub OAuth exchange is
> backend-only.
>
> **Cross-cutting fix included in this batch:** the download rate limiter now has
> its own bucket (`bucket="dl"`). Previously downloads (8/min/IP) and anonymous
> reads (300/min/IP) shared the same sliding-window key, so one busy reader could
> exhaust the download budget and 429 legitimate installs.

### M-7.3 Publisher console

1. Add authenticated hosted routes for:
   - account overview;
   - owned namespaces;
   - organizations and memberships;
   - public package/version management;
   - signing keys;
   - publication activity;
   - scan findings;
   - review history;
   - quotas and rate-limit status;
   - sessions and access credentials.
2. Show every version as immutable identity data: namespace, name, version, archive
   digest, signature fingerprint, publisher, publication time, review status, scan
   status, yank status, and revocation status.
3. Add manifest inspection and a security-focused diff from the previous version:
   permissions, secret names, interfaces, runtime, dependencies, model providers,
   commands, files, signer, and archive size.
4. Add signing-key registration with fingerprint confirmation, rotation, expiration,
   revocation, last-used time, and affected package versions.
5. Show namespace ownership and authorized maintainers; changing ownership requires
   reauthentication and an audited confirmation.
6. Show publish quotas, storage use, download use, rejected requests, and scan queue
   state.
7. Allow maintainers to yank versions and request re-scan, but reserve security
   verification and revocation for authorized reviewer/admin roles.
8. Provide copyable CLI and CI instructions that use scoped credentials and never
   embed secrets into generated examples.
9. Add accessible empty, loading, stale, permission-denied, suspended-account,
   rate-limited, and service-error states.
10. Enforce every action server-side against account status, role, namespace ACL,
    package ownership, and credential scope.

### M-7.4 Admin review panel

1. Queue pending versions by risk, publisher reputation, permission expansion,
   dependency changes, namespace sensitivity, scan findings, and publication time.
2. Show publisher identity, namespace ownership, signer fingerprint, archive digest,
   manifest, file inventory, scan findings, permissions, secrets requested, and diff
   from the previous version.
3. Allow `verify`, `warning`, `reject`, `revoke`, `yank`, `request changes`, and
   publisher suspension.
4. Require a structured reason and optional internal review notes.
5. Record reviewer identity and immutable audit events.
6. Prevent a reviewer from silently replacing package bytes, signatures, publisher
   identity, or the reviewed digest.
7. Provide emergency publisher suspension and package/version revocation.
8. Require re-review when package digest, version, signer, or security-relevant
   metadata changes.
9. Require recent reauthentication and stronger authentication for destructive or
   security-sensitive admin actions.
10. Add role-based authorization and separation-of-duty tests for reviewer and admin
    operations.

### M-7.5 Public agent catalog

1. Add the marketing `/agents` page backed by the M-6 catalog.
2. Show:
   - exact version and digest;
   - publisher identity and verification;
   - per-version review and automated scan status;
   - last scan/review timestamps;
   - permissions and secret names;
   - runtime, models, framework, interfaces, and license;
   - sandbox recommendation;
   - install command;
   - source repository and provenance where declared.
3. Make warnings and revocations visually distinct and accessible.
4. Do not imply that verified means guaranteed safe.
5. Add report-abuse and package-takedown entry points.
6. Use one canonical catalog client across marketing, hosted publisher console, and
   local dashboard browse views.
7. Add clear empty, offline, stale, rate-limited, and registry-error states.
8. Offer sign-in as an optional path to publisher/private features without placing
   the public catalog behind an authentication wall.

### M-7.6 Client security refresh

1. Refresh package status before install and update.
2. Refresh status before run when online, using a bounded cache.
3. Surface stale/offline status without silently upgrading trust.
4. Notify users about installed revoked versions in CLI and dashboard.
5. Require confirmation before updating from a verified version to an unverified new
   version if automatic updates are later introduced.
6. Keep hosted account/session status separate from local agent trust and sandbox
   decisions.

### M-7 verification gate

- Web and CLI authentication resolve to the same stable OpenAgentHub account.
- GitHub provider tokens and client secrets never reach browser JavaScript or CLI
  storage.
- Browser sessions resist CSRF, fixation, replay, and open-redirect attacks.
- CLI login uses a bounded one-time browser/device flow and stores credentials in the
  encrypted vault.
- Publishers can manage only their authorized namespaces, packages, and keys.
- The publisher console exposes immutable version identity, security diffs, scans,
  reviews, quotas, and sessions.
- Reviewers can approve or revoke exact digests with audited reasons.
- Public users can inspect meaningful security and permission metadata without
  signing in.
- Verified badges clearly identify whether they apply to publisher identity or exact
  package version.
- Revoked installed versions generate local warnings and are blocked by default.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Web and CLI authentication resolve to the same stable OpenAgentHub account.
- GitHub provider tokens/client secrets never reach browser JS or CLI storage.
- Browser sessions resist CSRF, fixation, replay, and open-redirect attacks.
- CLI login uses bounded one-time browser/device flow; credentials in encrypted vault.
- Publishers manage only authorized namespaces, packages, and keys.
- Reviewers approve/revoke exact digests with audited reasons.
- Public users inspect security metadata without signing in.
- E2E: Sign in via hosted web → authorize CLI device for same account.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **M-8**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
