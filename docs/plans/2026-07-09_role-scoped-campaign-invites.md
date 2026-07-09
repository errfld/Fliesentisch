# Role-scoped campaign invites

## Outcome

Add single-purpose player invite links for campaign presets. A bearer link may authenticate a new Google user, create player-only allowlist access, add a player seat to exactly one campaign, and never grant platform-admin or gamemaster authority.

## Backend

- Store only a SHA-256 token digest plus a short hint; return the bearer token once at creation.
- Persist expiry, optional maximum uses, revocation, unique-user redemptions, and invite-created restricted users.
- Keep redemption atomic and idempotent. New users receive `USER` / `PLAYER`; existing roles are preserved and campaign membership is never promoted.
- Permit admins to manage all campaign invites and gamemasters only for campaigns they already manage.
- Integrate invite redemption into Google callback and development login so unknown users can authenticate only through a valid invite.
- Deny invite-created restricted users access to legacy non-campaign rooms.

## Frontend

- Extend each campaign card with an invite-slip panel for create, one-time copy/open, status, usage, expiry, and revoke.
- Add `/invite/$token` as a thin route over an auth-aware invite landing feature.
- Show explicit invalid, revoked, expired, exhausted, and successful redemption states.

## Validation

- Backend persistence, authorization, expiry, revocation, max-use, idempotency, and role tests.
- Frontend invite-management and invite-landing unit tests.
- Multi-context Playwright coverage for GM creation, unknown-user dev authentication/redemption, room entry, and revoked-link handling.
- Repository lint, typecheck, unit tests, build, Rust fmt/clippy/tests/build, and headed Playwright CLI visual smoke test.
