# DnD Virtual Table

Local-first monorepo for a LiveKit-based DnD virtual table with whisper audio channels, PTT, and DM spotlight.

## Quickstart

1. Copy env files:
   - `cp backend/.env.example backend/.env`
   - `cp frontend/.env.local.example frontend/.env.local`
   - `cp infrastructure/.env.example infrastructure/.env`
2. Start infra: `pnpm compose:up`
3. Start app: `pnpm dev`

Local auth note:
- `pnpm compose:up` rebuilds the auth image and starts the local stack.
- `infrastructure/.env` must set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`; `AUTH_BIND_ADDR`, `JOIN_SECRET`, `ALLOWED_ROOMS`, `TOKEN_TTL_SECONDS`, and `FRONTEND_ORIGINS` are optional.
- If Vite logs `connect ECONNREFUSED 127.0.0.1:8787` for `/api/v1/token`, the auth service is not running on port `8787`; check the auth logs first.

## Structure

- `frontend`: TanStack Start + TypeScript + LiveKit UI
- `backend`: Rust axum token service
- `infrastructure`: docker compose, Caddy, LiveKit config, deploy scripts
- `docs/contracts`: protocol and API contracts
- `docs/plans`: implementation plans/session tracking

## Auth Docs

- `docs/google-oauth-onboarding.md`: Google Cloud and env setup for backend-owned OAuth
