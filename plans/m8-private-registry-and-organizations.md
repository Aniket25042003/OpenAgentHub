# M-8 — Private registry and organization console

> **Driver:** [plan.md](../plan.md) — read it first for goals, principles, architecture rules, and sequencing.
> **This file:** detailed implementation and testing plan for this milestone only.
> **Do not** implement later milestones from this file. **Do not** invent requirements that contradict [plan.md](../plan.md).

## Goal

Deliver only what this milestone defines. Prefer small reviewable PRs (see branch list below) over one large rewrite.

## Prerequisites

- M-7 complete.
- Follow the modular-monolith + independently deployed workers rules in [plan.md](../plan.md).
- Primary code areas: `registry/`, `web/`, `cli/`, `sdk/`.

## Suggested branches / PRs

- `feat/private-registry-organizations` — M-8.1–M-8.6
- `feat/private-access-audit-quotas` — M-8.7–M-8.9
- `feat/billing-device-foundation` — M-8.10–M-8.11

## Implementation plan

M-8 builds Docker Hub-style private collaboration on top of the M-7 identity and
publisher-console foundation. It covers private agent packages, not native hosting
of model weights or GPU inference.

Architecture alignment:

- Organizations, visibility, private authorization, quotas, billing entitlements,
  and audit remain domain modules within the hosted modular monolith.
- One authorization module evaluates web, CLI, API-token, and service-account access.
- Private archive bytes stay in object storage; the API authorizes and issues signed
  URLs without proxying large downloads through a new download microservice.
- Billing-provider reconciliation, notifications, audit export, quota aggregation,
  and retention run in independent workers.
- Cross-module private-package operations use one transaction plus outbox events,
  avoiding distributed transactions.
- Device enrollment is a versioned hosted/local API boundary, not direct database or
  message-broker access from the local daemon.

### M-8.1 Shared GitHub identity across web and CLI

1. Reuse the M-7 OpenAgentHub account for hosted web, CLI, organization, and private
   package authorization.
2. Do not create a second user table or separate private-registry identity system.
3. Display linked CLI and browser sessions in one security page.
4. Ensure account suspension, deletion, organization removal, and credential
   revocation propagate consistently across web, CLI, API, and downloads.
5. Support future linked identity providers without changing package ownership IDs.

### M-8.2 Browser sessions and CLI device authorization

1. Apply M-7 session/token classes to private package operations.
2. Require appropriately scoped credentials for private metadata and archive access.
3. Reauthenticate users before organization ownership transfer, billing changes,
   credential creation, or destructive private-package actions.
4. Let users name, inspect, and revoke browser devices, CLI devices, API tokens, and
   CI service accounts independently.
5. Reject private access when a session, membership, token, organization, or account
   becomes inactive.

### M-8.3 Organizations, teams, roles, and invitations

1. Add organizations with globally unique slugs and display names.
2. Add roles:
   - owner;
   - administrator;
   - maintainer/publisher;
   - security reviewer;
   - read-only member;
   - billing manager.
3. Add teams that can be granted access to namespaces or individual private agents.
4. Add expiring, single-use invitations with domain display, inviter identity, role,
   team, and organization context.
5. Require explicit acceptance and an authenticated account before membership.
6. Revoke package access promptly when a member or team is removed.
7. Prevent the last organization owner from leaving without transferring ownership.
8. Audit member, role, team, invitation, and ownership changes.
9. Add optional organization policies for required two-factor authentication,
   allowed email domains, verified publishers, and service-account use.
10. Reserve SAML SSO and SCIM provisioning for a later enterprise milestone.

### M-8.4 Public, private, and internal visibility

1. Add package visibility:
   - `public`: visible and installable anonymously;
   - `private`: visible only to explicitly authorized accounts, teams, or service
     accounts;
   - `internal`: visible to every active member of the owning organization.
2. Define visibility at the package level; changing visibility is audited and
   requires owner/admin authorization.
3. Apply visibility consistently to search, catalog, details, versions, manifests,
   signatures, scan findings, review data, download counts, webhooks, and archives.
4. Prevent private names, descriptions, tags, versions, and existence from leaking
   through public search, error timing, autocomplete, analytics, logs, or cache keys.
5. Use consistent not-found responses for callers without permission.
6. Prevent private dependencies from being resolved or disclosed to unauthorized
   users.
7. Define package transfer behavior between personal and organization namespaces.
8. Require confirmation and policy checks before changing a private/internal package
   to public.

### M-8.5 Private metadata and archive authorization

1. Centralize authorization in reusable service-layer policies; do not duplicate
   partial checks across FastAPI routes.
2. Authorize every metadata and archive request using account status, organization
   membership, team grants, package ACL, token scope, and package visibility.
3. Apply authorization before cache lookup whenever cache contents are
   identity-sensitive.
4. Partition or key caches by authorization context so private responses cannot be
   served to another tenant.
5. Prevent shared public CDN caching of private metadata and archives.
6. Encrypt private archive storage at rest and isolate object prefixes by tenant.
7. Record private package reads and downloads in security/audit events according to
   retention and privacy policy.
8. Add tests for horizontal privilege escalation, removed members, team changes,
   expired invitations, suspended organizations, and cache leakage.

### M-8.6 Signed private download URLs

1. After registry authorization, issue short-lived, single-purpose object-storage or
   CDN download URLs.
2. Bind URLs to the exact immutable archive object, digest, expiration, and allowed
   method.
3. Keep URL lifetime short enough to limit sharing while supporting large downloads
   and reasonable retries.
4. Never expose permanent object-store credentials or predictable private object
   locations.
5. Disable public caching and directory listing.
6. Verify archive digest and signature again in the CLI after download; URL
   authorization does not replace package integrity verification.
7. Handle interrupted and resumable downloads without extending authorization
   indefinitely.
8. Audit URL issuance rather than logging full signed URLs.

### M-8.7 Scoped API tokens and CI service accounts

1. Add user API tokens with explicit scopes such as:
   - `packages:read`;
   - `packages:publish`;
   - `packages:manage`;
   - `keys:manage`;
   - `members:manage`;
   - `audit:read`;
   - `billing:read`;
   - `billing:manage`.
2. Allow scopes to be narrowed to one organization, namespace, package, or
   environment where practical.
3. Display a token only once; store a one-way hash and identifiable prefix.
4. Support expiration, rotation, last-used time, source metadata, and immediate
   revocation.
5. Add organization-owned CI service accounts that are not tied to an employee’s
   personal membership lifecycle.
6. Require maintainers to register authorized signing keys separately from API
   authentication.
7. Prevent service accounts from interactive web login.
8. Add token-creation policy, maximum lifetime, and allowed-scope controls.
9. Detect and throttle credential stuffing and token enumeration attempts.

### M-8.8 Organization and private-package audit logs

1. Record:
   - sign-in, session, and credential events;
   - organization, team, role, and invitation changes;
   - namespace and package ownership changes;
   - private metadata and archive access;
   - publish, yank, visibility, scan, review, and revocation actions;
   - service-account and token lifecycle;
   - quota and billing-plan changes.
2. Include actor, organization, action, target, timestamp, result, credential class,
   request ID, and appropriate network metadata.
3. Redact secrets, OAuth tokens, API tokens, signed URLs, archive contents, and local
   machine data.
4. Make normal application paths append-only.
5. Provide filtering, pagination, retention information, and export.
6. Restrict audit access by role and audit access to the audit log itself.
7. Define retention and deletion behavior before offering compliance claims.

### M-8.9 Storage, download, and member quotas

1. Track package count, version count, archive bytes, monthly download bytes, request
   rate, organization members, service accounts, and audit retention.
2. Enforce quotas transactionally or through reservation so concurrent uploads
   cannot exceed limits.
3. Show current use, limit, forecast, and reset date in web and CLI.
4. Warn before limits are reached and return actionable errors when blocked.
5. Handle failed or abandoned uploads by releasing reserved capacity.
6. Exclude deduplicated bytes only if the billing and isolation model can do so
   without leaking cross-tenant object existence.
7. Add administrator overrides with expiry and audit records.
8. Protect quota endpoints from becoming a side channel for other tenants.

### M-8.10 Billing foundation

1. Define plans and entitlements independently from UI display:
   - private package count;
   - storage;
   - monthly bandwidth;
   - organization members;
   - service accounts;
   - audit retention;
   - support level.
2. Add organization billing ownership and billing-manager role.
3. Keep authorization and package access safe during payment failures and plan
   transitions; do not immediately destroy private artifacts.
4. Model trial, active, grace-period, past-due, suspended, and canceled states.
5. Record entitlement snapshots and billing-related audit events.
6. Design idempotent webhook processing before integrating a payment provider.
7. Keep payment-card data out of OpenAgentHub systems by using a hosted payment
   provider flow.
8. Provide usage export and clear retention/deletion rules.
9. Treat full paid-plan launch as a follow-up release if needed; M-8 must at least
   establish entitlement boundaries that do not require later authorization rewrites.

### M-8.11 Optional device enrollment

1. Keep hosted and local dashboards separate by default.
2. Add device enrollment only as an explicit opt-in using a one-time pairing flow.
3. Show exactly which normalized fields will leave the machine before enrollment.
4. Default shared data to minimal health summaries; do not upload prompts, responses,
   source paths, logs, environment variables, secrets, or third-party credentials.
5. Give organizations policy controls over whether devices may enroll and which
   metrics may be shared.
6. Issue a unique revocable device identity and narrow upload scopes.
7. Encrypt transport and authenticate both sides.
8. Provide per-device last-seen, product version, consent version, shared fields, and
   revoke/delete controls.
9. Queue no sensitive data indefinitely while offline.
10. Keep remote agent execution, remote shell, and automatic cloud synchronization
    out of the initial device-enrollment scope.

### M-8 hosted console surfaces

The hosted console should provide:

- account and session security;
- organization, team, role, and invitation management;
- public/private/internal package management;
- version, digest, manifest, signature, and security diffs;
- signing keys, API tokens, and service accounts;
- scan, review, yank, and revocation status;
- storage, bandwidth, member, and plan usage;
- billing ownership and entitlement state;
- private-package and organization audit logs;
- optional enrolled-device inventory without exposing local secrets.

The local dashboard remains responsible for installed agents, containers, local run
history, logs, token usage, subscription limits, local secrets, and sandbox
overrides.

### M-8 verification gate

- One account identity works across web and CLI without sharing provider tokens or
  browser cookies.
- Organization roles, teams, invitations, and removals are enforced server-side.
- Public, private, and internal packages have complete metadata and archive
  authorization coverage.
- Unauthorized users cannot discover private package existence through search,
  errors, caches, object paths, or timing-sensitive obvious differences.
- Private archives use short-lived signed download URLs and still pass client-side
  digest/signature verification.
- API tokens and CI service accounts are scoped, hashed, expiring, independently
  revocable, and audited.
- Quotas remain correct under concurrent upload/download activity.
- Billing entitlements do not bypass package authorization.
- Hosted audit logs capture sensitive administrative and private-package actions
  without logging credentials.
- Device enrollment is off by default, consented, minimally scoped, and revocable.
- Native model-weight hosting and GPU inference are not accidentally included in the
  private-agent implementation.

## Testing plan

Run relevant existing suites after each PR:

```bash
npm test
cd registry && uv run pytest -q
# when Docker/e2e required for this milestone:
OPENAGENTHUB_NO_DAEMON=1 test/e2e.sh
```

### Milestone-specific tests
- Organization roles, teams, invitations, and removals enforced server-side.
- Public/private/internal packages: complete metadata and archive authorization.
- Unauthorized users cannot discover private packages via search, errors, caches, paths.
- Private archives use short-lived signed URLs and still pass client digest/signature checks.
- API tokens and CI service accounts are scoped, hashed, expiring, revocable, audited.
- Quotas remain correct under concurrent upload/download.
- Billing entitlements do not bypass package authorization.
- Device enrollment off by default, consented, minimally scoped, revocable.
- E2E: create org → invite → private agent → unauthorized blocked → remove member → revoke CI token.

### Agent checklist before marking complete

1. Every verification-gate bullet in this file is true or explicitly deferred with a linked issue.
2. New/changed APIs update the OpenAPI contract and shared client (when hosted APIs change).
3. No secrets, tokens, prompts, or local paths leak into logs, dashboards, or audit payloads.
4. Commits and PR follow the GitHub principles in [plan.md](../plan.md).
5. Docs that mention changed commands/flags are updated in the same PR.

## Done when

All **verification gate** items in the Implementation plan section above pass, and the next milestone may begin: **Final release gate in [plan.md](../plan.md).**.

## Out of scope for this milestone

Anything listed under later milestones or under “Explicitly out of scope” in [plan.md](../plan.md).
