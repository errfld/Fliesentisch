# Google OAuth2/OIDC + Admin-Managed User Access Plan

## Summary

Add Google sign-in (OIDC via OAuth2) using Auth.js in `frontend`, replace join-key access with authenticated session access, and add an admin UI backed by SQLite to manage exactly which email addresses can log in.

This plan is designed to be implementation-ready and revision-friendly. If requirements change, update this file and the linked GitHub issue together.

## Confirmed Product Decisions

- Provider: Google only.
- Access policy: exact email allowlist.
- Join key: removed.
- User management: admin UI + DB.
- DB: SQLite file with persistent volume.
- Admin model: bootstrap admins from env.
- Unauthorized flow: deny with explicit page.
- Admin scope: user CRUD only.
- Room access: any room for allowed users.
- Display name: editable nickname.
- Stable identity for LiveKit: Google `sub`.
- Frontend->backend hardening: shared service secret.

## Current State (Repository)

- `backend` is a Rust token service (`/api/v1/token`) currently gated by optional `JOIN_SECRET` and optional `ALLOWED_ROOMS`.
- `frontend` currently has no login/session system and proxies `/api/v1/token` to backend.
- Room join flow is currently name + room + optional join key from client UI.
- No existing application database is present.
- Existing e2e coverage is whisper-focused multi-client behavior.

## Target Architecture

1. `frontend` owns user auth/session and admin user management.
2. `frontend` keeps acting as token-proxy, but now requires authenticated+authorized user session.
3. `backend` mints LiveKit tokens only for trusted frontend server calls (shared secret).
4. User allowlist + roles are persisted in SQLite (frontend-owned DB).

## Public Interface and Contract Changes

- New routes:
  - `/api/auth/*` via Auth.js.
  - `/admin/users` admin UI.
  - `/api/admin/users` CRUD endpoints for allowlist management.
- Changed route behavior:
  - `POST /api/v1/token` in frontend requires valid user session and active allowlisted user.
  - `identity` for backend token request is derived server-side from Google `sub`, not client-provided.
- Backend token API:
  - Requires shared secret header from frontend (reject direct unauthenticated callers).
  - `join_key` removed from request contract.

## Configuration Changes

### Frontend env vars

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DATABASE_URL` (SQLite file path)
- `AUTH_BOOTSTRAP_ADMIN_EMAILS` (comma-separated)
- `AUTH_SERVICE_SHARED_SECRET`

### Backend env vars

- `AUTH_SERVICE_SHARED_SECRET`

### Deprecated or removed from active flow

- `JOIN_SECRET`

## Data Model (Auth + Access)

Use Auth.js-compatible schema with role/access fields in `User`.

Required capabilities:

- Unique normalized email (`lowercase(trim(email))`) for exact allowlist matching.
- `role` field: `ADMIN | USER`.
- `isActive` field for quick disable without deleting user.
- Link Google account to user via Auth.js account tables.

Business rules:

- Non-allowlisted users cannot sign in.
- Disabled users cannot sign in.
- Must never allow removal/demotion of the last admin.

## Implementation Work Breakdown

1. Add auth+db dependencies in `frontend`:
   - `next-auth`, `@auth/prisma-adapter`, `prisma`, `@prisma/client`.
2. Add Prisma schema and migrations for auth + admin fields.
3. Add seed/bootstrap logic for `AUTH_BOOTSTRAP_ADMIN_EMAILS`.
4. Implement Auth.js config with Google provider and strict `signIn` authorization checks.
5. Add signed-out/signed-in home flow:
   - Signed out: Google sign-in CTA.
   - Signed in: room + editable nickname form.
6. Protect `/room/[room]` with server-side session check.
7. Add `/unauthorized` page.
8. Rework frontend `/api/v1/token`:
   - Require session.
   - Validate active user.
   - Derive LiveKit identity from Google `sub`.
   - Forward to backend with shared secret header.
9. Rework backend `/api/v1/token`:
   - Validate shared secret.
   - Remove join-key logic and related error variant.
10. Add admin UI and APIs for user CRUD and role/status management.
11. Update compose and env examples:
   - Add frontend volume for SQLite persistence.
   - Add OAuth and shared-secret env wiring.
   - Remove join-key wiring from docs/flow.
12. Update docs/contracts to reflect new auth and token behavior.

## Testing and Validation Plan

### Automated tests

1. Backend unit tests:
   - valid shared secret -> token minted.
   - missing/invalid shared secret -> `401`.
2. Frontend unit/integration:
   - email normalization behavior.
   - sign-in allowlist enforcement.
   - admin guardrails (last admin protection).
   - `/api/v1/token` rejects unauthenticated users.
3. Playwright:
   - allowed user sign-in and room join.
   - disallowed user denied.
   - admin adds user; new user can sign in.

### Realtime regression checks (required)

For frontend-impacting changes, validate with multiple simultaneous clients after auth changes:

- Use `pnpm --filter frontend clients:start -- Alice Bob Carol` (or equivalent) and verify room join + whisper flows still work.
- Re-run `frontend/e2e/whisper.spec.ts` to ensure no regression in multi-client behavior.

## Acceptance Criteria

1. Only allowlisted Google users can access room token flow.
2. Join key is no longer required or used.
3. Admin can manage users via UI (add/remove, activate/deactivate, admin flag).
4. Backend token minting cannot be called directly without service secret.
5. Existing room and whisper UX remains functional for multiple concurrent clients.
6. Environment and deployment docs are updated and actionable.

## Rollout and Migration

1. Create Google OAuth client and set redirect URI:
   - `https://<domain>/api/auth/callback/google`
   - local dev equivalent if needed.
2. Set required env vars for frontend/backend.
3. Run DB migration and bootstrap admin seed.
4. Deploy updated frontend/backend together (shared-secret dependency).
5. Verify admin login and add all intended users before broad use.

## Risks and Mitigations

- Risk: admin lockout by accidental role changes.
  - Mitigation: enforce "at least one admin" invariant in API layer.
- Risk: backend token endpoint abused if exposed.
  - Mitigation: shared secret verification + avoid exposing backend port publicly in production.
- Risk: nickname abuse (very long/invalid strings).
  - Mitigation: server-side validation and length limits before token minting.

## Out of Scope (This Phase)

- Per-user room ACLs.
- Invitation emails or approval workflows.
- Audit logging and admin action history.
- Additional identity providers besides Google.

## Revision Protocol

When plan changes are needed:

1. Update this file first with dated change notes.
2. Update linked GitHub issue body/checklist to match.
3. Keep accepted decisions and assumptions explicit to avoid implementer drift.
