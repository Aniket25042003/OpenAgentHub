# Registry — Review, quarantine & revocation

## Status fields on a version

Every published version carries two independent status fields:

- `security` (`SecurityReport.status`): result of the automated archive scan —
  `pending` (before scan), `clean`, `flagged`, `failed`.
- `reviewStatus`: human review state — `pending` (default, until a reviewer
  acts), `verified`, `warning`, `rejected`, `revoked`.

New versions are published as `pending`. The automated manifest validation and
archive scan run synchronously before the version becomes publicly
downloadable. A manual reviewer (role `reviewer` or `admin`) then decides the
`reviewStatus`.

## Review actions

`POST /api/v1/admin/agents/{namespace}/{name}/versions/{version}/review`
(auth: reviewer/admin):

```json
{ "action": "verify|warning|reject|revoke", "reason": "required, max 2000 chars", "notes": "optional internal notes" }
```

| action  | resulting reviewStatus | download allowed |
| --- | --- | --- |
| `verify` | `verified` | yes |
| `warning` | `warning` | yes (client shows warning) |
| `reject` | `rejected` | no (403) |
| `revoke` | `revoked` | no (403) |

Every review records an immutable `VersionReviewEvent` holding the exact
reviewed digest (`sha256`), signer fingerprint, reviewer id, action, reason,
notes and timestamp. Review changes are also written to the audit log.

## Quarantine / download blocking

`GET /api/v1/agents/{namespace}/{name}/versions/{version}/archive` returns
`403` for versions that are:

- `reviewStatus` `rejected` or `revoked`;
- `security` `flagged` (automated scan found hostile content).

Yanked versions (`POST .../yank`) remain downloadable but are marked; yanking is
a soft policy flag, not a security action.

## Revocation feed

`GET /api/v1/revocations` (public, read-only) returns every currently blocked
version — namespace, name, version, digest, reason, review/security status and
last-updated time. Clients refresh this feed before install/run:

- install aborts for blocked versions with the registry's reason;
- `run` checks the feed when online and blocks execution; when the registry is
  unreachable the last-known status is retained and the openagenthub runs with
  container isolation (never silent process trust).

## Rescan

`POST /api/v1/agents/{namespace}/{name}/versions/{version}/scan` (auth: active
user) re-runs the automated scan. Requests are throttled per version
(`REGISTRY_RESCAN_COOLDOWN_SECONDS`, default 10 s) and return `429` with
`Retry-After` when too frequent. Scans are also requested through the outbox
queue (`scan.requested`) so concurrent duplicate scans are naturally deduplicated
by the worker.

## Offline client behavior

- Last known status is stored in the local install record (`reviewStatus`,
  `statusCheckedAt`).
- Status is considered fresh for one hour; after that `run` refreshes it from
  the feed.
- If the refresh fails: warn, keep the last-known status, and default to
  container isolation rather than silently trusting.
- A `process` sandbox override is never honored for untrusted/unknown agents or
  for versions whose digest changed since the override was set.
