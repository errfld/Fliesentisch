# Google OAuth2/OIDC + Backend-Owned User Access Plan

## Summary

Add Google sign-in (OIDC via OAuth2) in the Rust `backend` auth service, keep the `frontend` as a SPA, replace join-key access with authenticated session access, and add a SQLite-backed user store for who can log in.

This plan is designed to be implementation-ready and revision-friendly. If requirements change, update this file and the linked GitHub issue together.

## Confirmed Product Decisions

- Provider: Google only.
- Access policy: exact email allowlist.
- Join key: removed once backend auth enforcement lands.
- User management: backend-owned auth APIs + DB.
- DB: SQLite file with persistent volume.
- Admin model: bootstrap admins from env.
- Unauthorized flow: deny with explicit page.
- Admin scope: user CRUD only.
- Room access: any allowed user may join any room.
- Display name: editable nickname.
- Stable identity for LiveKit: Google `sub`.
- Frontend stays a SPA and does not own session state.
- Game roles: `gamemaster` and `player`.

## Current State (Repository)

- `backend` is a Rust token service (`/api/v1/token`) currently gated by optional `JOIN_SECRET` and optional `ALLOWED_ROOMS`.
- `frontend` is now a TanStack Start SPA build, not a server-rendered app server.
- Production `/api/v1/*` traffic is routed directly to `backend` by Caddy.
- Room join flow is currently name + room + optional join key from client UI.
- No existing application database is present on `main`.
- Existing e2e coverage is whisper-focused multi-client behavior.

## Target Architecture

1. `backend` owns Google OAuth, session cookies, user storage, and admin APIs.
2. `frontend` remains a SPA and consumes backend auth/session endpoints.
3. `backend` mints LiveKit tokens only for authenticated and authorized users.
4. User allowlist + roles are persisted in backend-owned SQLite.

## Public Interface and Contract Changes

- New backend routes:
  - Google OAuth start/callback/logout/session endpoints.
  - Admin user CRUD endpoints for allowlist management.
- Changed route behavior:
  - `POST /api/v1/token` requires valid backend session and active allowed user.
  - `identity` for token request is derived server-side from Google `sub`, not client-provided.
- Token API:
  - `join_key` is removed from the request contract when auth enforcement is active.

## Configuration Changes

### Backend env vars

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_BASE_URL`
- `AUTH_COOKIE_SECRET`
- `AUTH_DATABASE_URL` (SQLite file path)
- `AUTH_BOOTSTRAP_ADMIN_EMAILS` (comma-separated)
- `AUTH_BOOTSTRAP_GAMEMASTER_EMAILS` (comma-separated)
- `AUTH_BOOTSTRAP_PLAYER_EMAILS` (comma-separated)

### Deprecated or removed from active flow

- `JOIN_SECRET`

## Data Model (Auth + Access)

Use a backend-owned SQLite schema for users and sessions.

Required capabilities:

- Unique normalized email (`lowercase(trim(email))`) for exact allowlist matching.
- `platform_role` field: `ADMIN | USER`.
- `game_role` field: `GAMEMASTER | PLAYER`.
- `isActive` field for quick disable without deleting user.
- Store Google subject/email linkage in backend tables.

Business rules:

- Non-allowlisted users cannot sign in.
- Disabled users cannot sign in.
- Must never allow removal or demotion of the last admin.
- Exactly one game role per user.

## Implementation Work Breakdown

1. Add SQLite-backed user store in `backend`.
2. Add bootstrap logic for admin, gamemaster, and player users.
3. Add backend session storage and Google OAuth flow.
4. Add backend auth endpoints for login/logout/session state.
5. Rework `POST /api/v1/token` to require backend session and active allowed user.
6. Remove join-key logic once auth enforcement is active.
7. Add backend admin APIs for user CRUD and role/status management.
8. Update frontend SPA to consume backend auth/session state and stop sending join keys.
9. Update compose and env examples for SQLite persistence and OAuth config.
10. Update docs/contracts to reflect new auth and token behavior.

## Testing and Validation Plan

### Automated tests

1. Backend unit tests:
   - valid shared secret or session enforcement path mints token
   - missing or invalid auth state returns `401`
2. Backend integration tests:
   - email normalization behavior
   - bootstrap role seeding for `gamemaster` and `player`
   - sign-in allowlist enforcement
   - admin guardrails (last admin protection)
   - `/api/v1/token` rejects unauthenticated users
3. Playwright:
   - allowed user sign-in and room join
   - disallowed user denied
   - admin adds user; new user can sign in

### Realtime regression checks (required)

For frontend-impacting changes, validate with multiple simultaneous clients after auth changes:

- Use `pnpm --filter frontend clients:start -- Alice Bob Carol` (or equivalent) and verify room join + whisper flows still work.
- Re-run `frontend/e2e/whisper.spec.ts` to ensure no regression in multi-client behavior.

## Acceptance Criteria

1. Only allowlisted Google users can access room token flow.
2. Join key is no longer required or used after auth enforcement ships.
3. Admin can manage users and assign `gamemaster` or `player` role.
4. Backend token minting is blocked for unauthenticated users.
5. Existing room and whisper UX remains functional for multiple concurrent clients.
6. Environment and deployment docs are updated and actionable.

## Rollout and Migration

1. Create Google OAuth client and set backend callback URI.
2. Set required env vars for frontend and backend.
3. Run DB bootstrap and seed initial admin, gamemaster, and player users.
4. Deploy updated frontend and backend together.
5. Verify admin login and add all intended users before broad use.

## Risks and Mitigations

- Risk: admin lockout by accidental role changes.
  - Mitigation: enforce "at least one admin" invariant in backend APIs.
- Risk: backend token endpoint remains reachable during migration.
  - Mitigation: keep join-key gate until session-based enforcement is active, then remove it.
- Risk: nickname abuse (very long or invalid strings).
  - Mitigation: server-side validation and length limits before token minting.

## Out of Scope (This Phase)

- Per-user room ACLs beyond `gamemaster` vs `player`.
- Invitation emails or approval workflows.
- Audit logging and admin action history.
- Additional identity providers besides Google.

## Revision Protocol

When plan changes are needed:

1. Update this file first with dated change notes.
2. Update linked GitHub issue body/checklist to match.
3. Keep accepted decisions and assumptions explicit to avoid implementer drift.
