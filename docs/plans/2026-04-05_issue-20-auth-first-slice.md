# Issue 20 Auth First Slice

## Goal

Start issue `#20` with the backend primitives that unblock the rest of the work:

- SQLite-backed allowlist lookup by normalized email
- Google subject linking for allowlisted users
- backend-owned auth session persistence
- tests around bootstrap seeding and auth/session behavior

## This Slice

1. Extend `backend/src/users.rs` to support:
   - allowlist lookup
   - linking `google_subject`
   - persisting auth sessions
2. Keep the current token route working while auth primitives are introduced.
3. Add backend tests for:
   - email normalization on allowlist auth
   - rejecting unknown users
   - rejecting Google subject mismatch
   - session create/read/delete flow

## Next Slices

1. Add cookie helpers and backend session endpoints.
2. Add Google OAuth start/callback/logout routes.
3. Change `/api/v1/token` to require an authenticated backend session and derive LiveKit identity server-side.
4. Update frontend join flow to use backend auth state instead of join keys.
