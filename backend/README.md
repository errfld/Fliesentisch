# Backend Auth Service

Rust + axum service that currently mints LiveKit access tokens and now owns the auth user store.

## Endpoints

- `GET /api/v1/health`
- `POST /api/v1/token`

## Run

```bash
cp .env.example .env
cargo run
```

## User Store

The service initializes a SQLite database on startup and bootstraps configured users into it.

- `AUTH_DATABASE_URL`: SQLite connection string.
- `AUTH_BOOTSTRAP_ADMIN_EMAILS`: comma-separated emails promoted to platform admins.
- `AUTH_BOOTSTRAP_GAMEMASTER_EMAILS`: comma-separated emails seeded as gamemasters.
- `AUTH_BOOTSTRAP_PLAYER_EMAILS`: comma-separated emails seeded as players.

Bootstrap users are additive:

- existing users are reactivated if present in bootstrap config
- admin bootstrap promotes to admin, but does not demote existing admins
- gamemaster bootstrap promotes to gamemaster, but does not demote existing gamemasters

## OAuth Onboarding

See `docs/google-oauth-onboarding.md` for Google Cloud setup, redirect URI guidance, and required env vars for the backend-owned OAuth flow.
