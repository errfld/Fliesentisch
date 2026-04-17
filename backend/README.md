# Backend Auth Service

Rust + axum service that currently mints LiveKit access tokens and now owns the auth user store.

## Endpoints

- `GET /api/v1/health`
- `GET /api/v1/auth/session`
- `GET /api/v1/auth/google/login`
- `GET /api/v1/auth/google/callback`
- `POST /api/v1/auth/logout`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `PATCH /api/v1/admin/users/:id`
- `DELETE /api/v1/admin/users/:id`
- `POST /api/v1/token`

Development-only helper:

- `GET /api/v1/auth/dev-login`
  - enabled only when `AUTH_ENABLE_DEV_LOGIN=true`
  - intended for Playwright and local multi-client validation, not production auth

## Run

```bash
cp .env.example .env
cargo run
```

## User Store

The service initializes a SQLite database on startup and bootstraps configured users into it.

- `AUTH_DATABASE_URL`: SQLite connection string.
- `AUTH_BASE_URL`: public browser origin used for Google callback redirects and same-origin cookies.
- `AUTH_COOKIE_SECRET`: HMAC secret used to sign auth-related cookies.
- `AUTH_SESSION_TTL_SECONDS`: backend session lifetime in seconds.
- `AUTH_BOOTSTRAP_ADMIN_EMAILS`: comma-separated emails promoted to platform admins.
- `AUTH_BOOTSTRAP_GAMEMASTER_EMAILS`: comma-separated emails seeded as gamemasters.
- `AUTH_BOOTSTRAP_PLAYER_EMAILS`: comma-separated emails seeded as players.
- `GOOGLE_CLIENT_ID`: Google OAuth web client id.
- `GOOGLE_CLIENT_SECRET`: Google OAuth web client secret.
- `AUTH_ENABLE_DEV_LOGIN`: optional development-only auth bypass for browser automation.

The backend persists:

- `users` for allowlisted auth identities and roles
- `auth_sessions` for backend-owned login sessions

Current auth primitives in the store:

- exact allowlist lookup by normalized email
- linking a Google `sub` to an allowlisted user
- creating, resolving, and deleting backend auth sessions

Bootstrap users are additive:

- existing users are reactivated if present in bootstrap config
- admin bootstrap promotes to admin, but does not demote existing admins
- gamemaster bootstrap promotes to gamemaster, but does not demote existing gamemasters

## OAuth Onboarding

See `docs/google-oauth-onboarding.md` for Google Cloud setup, redirect URI guidance, and required env vars for the backend-owned OAuth flow.
