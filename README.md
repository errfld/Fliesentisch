# DnD Virtual Table

Local-first monorepo for a LiveKit-based DnD virtual table with whisper audio channels, PTT, and DM spotlight.

## Quickstart

1. Copy env files:
   - `cp backend/.env.example backend/.env`
   - `cp frontend/.env.local.example frontend/.env.local`
   - `cp infrastructure/.env.example infrastructure/.env`
2. Start infra: `pnpm compose:up`
3. Start app: `pnpm dev`

## Structure

- `frontend`: Next.js + TypeScript + LiveKit UI
- `backend`: Rust axum token service
- `infrastructure`: docker compose, Caddy, LiveKit config, deploy scripts
- `docs/contracts`: protocol and API contracts
- `docs/plans`: implementation plans/session tracking
