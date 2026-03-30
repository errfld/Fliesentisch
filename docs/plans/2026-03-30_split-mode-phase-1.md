# Split Mode Phase 1

## Current Repo Check
- `frontend` already has a clean room-session ownership boundary under `frontend/src/features/room-session/`.
- Whisper and spotlight state are client-coordinated over the LiveKit data channel via `frontend/src/lib/protocol.ts` and `frontend/src/store/whisperStore.ts`.
- `backend` now stores `gamemaster` vs `player` roles in SQLite bootstrap data, but `POST /api/v1/token` still does not expose a trusted role or consume a trusted authenticated user identity.

## Conclusion
- The split-mode plan still holds.
- The current repo is ready for the shared split-state model, reducer/store, selector seams, and room-session composition changes.
- The repo is not yet ready for true GM-authoritative control, because trusted role exposure and authenticated user identity are still missing from the token/session path.

## Phase 1 Scope
1. Extend the frontend protocol/types to represent split state.
2. Add a dedicated split-room store with reducer tests.
3. Thread split state into room-session selectors and composition in a way that preserves current behavior when split mode is inactive.
4. Leave GM-only controls and authoritative command publishing behind a capability seam so the later auth work can plug into it.

## Explicit Non-Goals For This Slice
- No fake or query-param-based GM role.
- No attempt to finalize backend authority without authenticated user identity.
- No transport-level room isolation redesign.

## Exit Criteria
- Split-state payloads and reducers exist with test coverage.
- Room-session selectors can derive room-filtered participant, tile, and audio views from split state.
- Current whisper behavior remains intact when split mode is inactive.
- The remaining blocker is clearly isolated to trusted auth/authority plumbing, not mixed into frontend state code.
