# Registry — Auth & keys

`app/identity/application.py`, `app/identity/routes.py`

## Identity model

- Users are stored in the `users` table; identity is keyed by GitHub
  (`github_id` unique).
- Users carry a `role` (`publisher` | `reviewer` | `admin`) and a `status`
  (`active` | `suspended`). Suspended accounts are rejected on every mutating
  route with 403. Admin endpoints require `admin`; review/yank endpoints
  require `reviewer` or `admin`.
- Agents have an `owner_id`; signing keys belong to users; namespaces belong
  to a single owner account with an explicit maintainer ACL.

## JWT

- `issue_token(user_id, username)` → HS256 JWT with `sub`, `username`, `iat`,
  `exp` (`REGISTRY_TOKEN_TTL_SECONDS`, default 7 days).
- `decode_token` + `get_current_user` (FastAPI `HTTPBearer` dependency) protect
  publish/keys/me routes. Invalid/expired → 401. `require_active_user` adds a
  403 for suspended accounts; `require_admin` / `require_reviewer_or_admin`
  gate the `/admin/...` endpoints.

## GitHub OAuth exchange

`POST /api/v1/auth/github { code }`:

1. Requires `REGISTRY_GITHUB_CLIENT_ID` + `REGISTRY_GITHUB_CLIENT_SECRET` to be
   set — otherwise 503.
2. POSTs the code to `REGISTRY_GITHUB_TOKEN_URL` for an access token.
3. GETs the user profile from `REGISTRY_GITHUB_USER_URL` with that token.
4. Upserts the user and returns `{ token: <jwt>, username }`.

This is the API-level flow (used by the web UI / third-party clients). The
**CLI does not do a browser OAuth dance** — see below.

## How the CLI authenticates

`openagenthub login --token <token> --registry <url>`:

- Stores whatever token you pass (a GitHub PAT works, or a registry-issued
  JWT) into `config.json` as `token`, and sets `registryUrl`.
- Verifies by calling `GET /api/v1/me`. If the registry is unreachable it
  still stores the token and warns.
- The e2e harness mints a JWT directly via `issue_token` against a temp DB and
  passes it with `openagenthub login --token`.

So the registry accepts bearer JWTs; `exchangeGitHubToken` is how a JWT is
obtained from a GitHub OAuth code.

## Signing keys

`POST /api/v1/keys { publicKey, label?, expiresAt? }`:

- Validates the PEM parses as an Ed25519 public key → 400 otherwise.
- Computes `public_key_fingerprint` (sha256 of SPKI DER, first 16 hex).
- Registers it (idempotent by fingerprint) to the current user; a fingerprint
  already registered to a **different** account → 409.
- `DELETE /api/v1/keys/{id}` revokes the key (owner only; idempotent).
  Revoked or expired keys can no longer sign new versions (403 on publish).
- `GET /api/v1/me` lists a user's keys with `id`, `fingerprint`, `label`,
  `revoked`, `expired`.
- Key upload, revocation, and suspension are recorded in the audit log.

**Publish requires the signature's `publicKeyId` to match an active key
registered to the authenticated publisher.** Unknown, cross-account, revoked,
or expired keys are rejected with 403. Historical versions remain verifiable
after a key is revoked; the version detail surfaces `signerKey.revoked`.

## Config for auth

| Env | Purpose |
| --- | --- |
| `REGISTRY_GITHUB_CLIENT_ID` / `..._SECRET` | OAuth app credentials |
| `REGISTRY_GITHUB_TOKEN_URL` | default `https://github.com/login/oauth/access_token` |
| `REGISTRY_GITHUB_USER_URL` | default `https://api.github.com/user` |
| `REGISTRY_JWT_SECRET` | JWT signing secret — **change from default in prod** |
| `REGISTRY_JWT_ALGORITHM` | HS256 |
| `REGISTRY_TOKEN_TTL_SECONDS` | JWT lifetime |

## Gotchas

- The default `REGISTRY_JWT_SECRET=change-me` logs a warning at startup.
- Never log tokens or secret values; `config.json` is written mode `0o600`.
