# M-9 — Account self-service completion and documentation gap fixes

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** implementation plan closing the **audit-confirmed gaps** left after M-0…M-8.

## Why this milestone exists

A full audit of `plan.md` and every `plans/m*-…md` milestone file against the
merged codebase found two concrete gaps plus one intentionally deferred item:

1. **M-7.1 item 7 (marked `DONE` but only partially implemented)** — *"Add
   account pages for profile, linked identity, active sessions, account status,
   security events, and account deletion."* The `/account` web page today only
   shows **active sessions** and **agreements**. There is no profile view, no
   linked-identity display, no account-status display, no security-events feed,
   and no account-deletion flow.
2. **M-1.1 item 4 (flagged `[IMPLEMENTED]*` partial)** — *"Document the
   alias-removal timeline."* `docs/cli/README.md` says *"see the deprecation
   timeline in `AGENTS.md`"*, but no such timeline exists anywhere in the
   repository — a dangling reference.
3. **M-8.11 (device enrollment)** — explicitly, intentionally deferred in the
   M-8 milestone file. **Not a gap**; out of scope here.

Everything below exists only to close the first two gaps. No new scope.

## Scope

### M-9.1 Account self-service (backend)

All in the existing `registry/app/identity` module. No schema/table changes.

1. **Profile endpoint (cookie-auth).** Add `GET /api/v1/me/profile` returning the
   existing-but-unused `AuthMeResponse` shape (username, role, status,
   `githubId`, `avatarUrl`, agreements):
   this is the "profile" + "linked identity" + "account status" surface.
2. **Security events endpoint.** Add `GET /api/v1/me/security-events` returning
   a recent audit feed for the caller (`actor_id = me`), sourced from
   `AuditRepository.recent_for_actor`. Include action, target, detail, timestamp.
3. **Account deletion endpoint.** Add `POST /api/v1/me/delete` (cookie
   auth, current user) that — after an explicit `confirm: "delete-account"` body flag:
   - revokes all sessions / API tokens / signing keys for the account;
   - removes the account from all organizations and teams it belongs to;
   - marks `users.status = 'deleted'`;
   - records an `account.deleted` audit event;
   - keeps published/draft package rows but blocks all further publish/activity
     because `require_active_user`/`require_cookie_active` already gate on
     `status == "active"`.
4. All three endpoints are wired on the existing `identity_router`; no new
   module, no migration.
5. Outcomes validated in tests: profile shape, security-events listing, deletion
   blocks re-login/publish, deletion revokes tokens/sessions, owner role
   preserved by nothing (role stays but status dead).

### M-9.2 Account page (web `web/src/app/account` + BFF)

1. Extend the account page to render:
   - a **Profile / linked identity** block (username, GitHub handle id, avatar,
     account status badge);
   - a **Security events** table (recent audit feed);
   - a **Delete account** section (type-to-confirm button calling deletion).
2. Add BFF routes `web/src/app/api/account/profile`, `…/security-events`,
   `…/delete` mirroring the existing `sessions` BFF pattern
   (`web/src/lib/account-bff.ts`).
3. Keep everything else on the page unchanged.

### M-9.3 Documentation gap fixes

1. Add an **"Agent alias deprecation timeline"** section to `AGENTS.md` that
   actually documents when `agent` will be removed (one release after next major,
   matching `plans/m1-one-package-distribution.md`), so the
   `docs/cli/README.md` pointer is no longer dangling.
2. Ensure `docs/cli/README.md` wording matches the new section.

### M-8.2 (device enrollment)

Intentionally deferred per the M-8 plan; nothing to build. Noted here so the
milestone audit doesn't re-flag it.

## Out of scope

- Hard delete / GDPR-purge of package rows owned by a deleted account (write
  path is blocked after deletion; data justification is a later privacy
  milestone).
- Sending e-mails or any outbox/notification work.
- Device enrollment (M-8.2).
- Any change to the manifest schema, SDK, or sandbox logic.

## Suggested branch / PR

Continue the current release line. One PR:

`feat/account-self-service-gaps` — M-9.1–M-9.3

## Verification gate

- `cd registry && uv run pytest -q` — new tests for the four endpoints plus the
  existing suite (currently 195) stay green.
- `scripts/export_openapi.py` refreshed; `test_architecture.py` allowlist
  updated if the new imports demand it.
- `npm run build -w @openagenthub/web` succeeds.
- `test/e2e.sh` stays green (or regression noted with reason).
- `AGENTS.md` + `docs/cli/README.md` render with no dangling alias-timeline
  reference.

## Done when

All **verification gate** items above pass and the account page shows profile,
linked identity, account status, an activity/security-events feed, sessions,
agreements, and a working delete-account flow.