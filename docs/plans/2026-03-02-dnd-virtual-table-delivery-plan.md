# DnD Virtual Table Delivery Plan

## Scope

Implement the local-first monorepo and product milestones for:

- main table call,
- whisper channels,
- push-to-talk,
- spotlight mode,
- CI/CD,
- VPS deployment.

## Locked decisions

- GitHub Actions + SSH deploy (`docker compose pull && docker compose up -d`)
- `pnpm` workspaces + Turborepo
- Caddy reverse proxy
- Zustand for frontend state
- LiveKit DataChannel for whisper sync
- Shared `JOIN_SECRET` auth gate for MVP

## Phase breakdown

1. Phase 0: Foundation and contracts
2. Phase 1: Main call
3. Phase 2: Whisper MVP
4. Phase 3: PTT and ducking
5. Phase 4: Spotlight and polish
6. Phase 5: CI/CD and deploy automation
7. Phase 6: Hardening (TURN, rate limits, observability)

## Session execution model

Each session targets one phase slice and must include:

- implementation,
- automated checks,
- manual acceptance notes,
- docs updates.
