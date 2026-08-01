# Registry — Auth & keys

`app/auth.py`, `app/routers/auth.py`, `app/routers/keys.py`

## Identity model

- Users are stored in the `users` table; identity is keyed by GitHub
  (`github_id` unique).
- Agents have an `owner_id`; signing keys belong to users.

## JWT

- `issue_token(user_id, username)` → HS256 JWT with `sub`, `username`, `iat`,
  `exp` (`REGISTRY_TOKEN_TTL_SECONDS`, default 7 days).
- `decode_token` + `get_current_user` (FastAPI `HTTPBearer` dependency) protect
  publish/keys/me routes. Invalid/expired → 401.

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

`agent login --token <token> --registry <url>`:

- Stores whatever token you pass (a GitHub PAT works, or a registry-issued
  JWT) into `config.json` as `token`, and sets `registryUrl`.
- Verifies by calling `GET /api/v1/me`. If the registry is unreachable it
  still stores the token and warns.
- The e2e harness mints a JWT directly via `issue_token` against a temp DB and
  passes it with `agent login --token`.

So the registry accepts bearer JWTs; `exchangeGitHubToken` is how a JWT is
obtained from a GitHub OAuth code.

## Signing keys

`POST /api/v1/keys { publicKey }`:

- Validates the PEM parses as an Ed25519 public key → 400 otherwise.
- Computes `public_key_fingerprint` (sha256 of SPKI DER, first 16 hex).
- Registers it (idempotent by fingerprint) to the current user.
- `GET /api/v1/me` lists a user's keys.

Publish does **not** require the key to be pre-registered today (the signature
is verified with the public key in the signature file); key registration
exists to support verified-publisher attribution going forward.

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
