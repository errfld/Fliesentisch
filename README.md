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
- `infrastructure/.env` should include `APP_BASE_URL=http://localhost:3000` for local Vite dev.
- If Vite logs `connect ECONNREFUSED 127.0.0.1:8787` for `/api/v1/token`, the auth service is not running on port `8787`; check the auth logs first.

## Structure

- `frontend`: TanStack Start + TypeScript + LiveKit UI
- `backend`: Rust axum token service
- `infrastructure`: docker compose, Caddy, LiveKit config, deploy scripts
- `docs/contracts`: protocol and API contracts
- `docs/plans`: implementation plans/session tracking
