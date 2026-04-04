# GM-Controlled Split Rooms

## Summary

- Add a GM-only `Split Mode` that partitions one table into `Main Table` plus up to 3 GM-named side rooms.
- During a split, players only see and hear participants assigned to their room. The GM sees all participants, can talk to one focused room, and can optionally broadcast to every room.
- Split-state commands and assignments must be authoritative. In the recommended one-room v1, transport isolation is still cooperative client behavior, not a hard security boundary.
- Reconnects must restore room assignment from trusted state, not from client memory.
- Existing whispers remain available, but only within the participant's current split room.

## Current Baseline After Merging `main`

- The room route is now thin: `frontend/src/routes/room.$room.tsx` renders `frontend/src/components/RoomSession.tsx`, which composes feature hooks and UI from `frontend/src/features/room-session/`.
- Realtime room state is currently client-coordinated for whispers and spotlight:
  - protocol types live in `frontend/src/lib/protocol.ts`
  - whisper state lives in `frontend/src/store/whisperStore.ts`
  - message handling and selective whisper subscriptions live in `frontend/src/features/room-session/hooks/useWhisperSession.ts`
- The backend is still only a token-minting service in `backend/src/main.rs`. It validates room and join key, but it does not expose trusted `GM | PLAYER` roles or maintain authoritative room state.

## Architectural Constraint

- The current whisper design is cooperative. Clients receive room data over LiveKit and locally choose which tracks to subscribe to.
- That is sufficient for whispers, but it is not enough to make GM-controlled split rooms truly server-authoritative.
- Before implementation starts, we need one explicit product decision:
  - Recommended v1: keep one LiveKit room, add trusted GM authority plus authoritative split-state distribution, and accept that isolation is enforced by the shipped client rather than by transport-level hard security.
  - Stronger but much larger option: represent split rooms as separate LiveKit rooms or server-managed subscription permissions. That changes reconnect, GM presence, and broadcast design substantially.

## Preconditions

1. Add trusted participant role data to the join/bootstrap path.
   - Extend `backend/src/main.rs` and `docs/contracts/token-api.md` so the frontend can reliably distinguish `GM` from `PLAYER`.
   - Do not gate split controls from display name or query params.
2. Introduce an authoritative split-state source.
   - Current `STATE_SNAPSHOT` handling is peer-to-peer. Split-room assignment, focus, and broadcast state should not be authored by arbitrary clients.
   - Minimum acceptable shape: one trusted publisher path for split-state snapshots and updates, plus rejection of non-GM commands.

## Auth Handoff Requirements

- The frontend needs trusted role data before split controls render.
- Minimum contract for auth/bootstrap work:
  - stable participant identity used in split assignments
  - trusted participant role: `GM | PLAYER`
  - enough trusted session data for the room-session layer to know whether the local client may issue split commands
- `frontend/src/features/room-session/hooks/useRoomConnection.ts` should expose the trusted role alongside `identity`, rather than forcing split-room logic to refetch or infer it later.
- Do not couple split authorization to display names, query params, or client-generated flags.

## Recommended Implementation Slices

1. Extend the protocol and contracts for split state.
   - Update `frontend/src/lib/protocol.ts` and `docs/contracts/datachannel-protocol.md`.
   - Add `SplitRoom`, `SplitAssignment`, and `SplitState` types.
   - Add authoritative events for split start/end, room upsert/remove, assignment changes, GM focus, and GM broadcast.
   - Keep whisper and spotlight payloads separate; split state should coexist with them, not replace them.
2. Add a dedicated split-room state layer beside whisper state.
   - Create a new store and hook under `frontend/src/features/room-session/`, for example `hooks/useSplitRoomSession.ts` plus a `splitRoomStore`.
   - Mirror the current room-session architecture instead of expanding `frontend/src/components/RoomSession.tsx` into another monolith.
   - Keep route/session entry components thin and push room-state logic into feature hooks/selectors.
3. Refactor media subscription control into one place.
   - Today, whisper audio subscription rules are embedded in `frontend/src/features/room-session/hooks/useWhisperSession.ts`.
   - Split rooms need one subscription policy that considers:
     - current split assignment
     - whisper membership
     - GM focus room
     - GM broadcast state
   - Expected outcome: move track-subscription decisions into a shared helper or hook used by room-session composition.
4. Add split-aware selectors for the current room view.
   - Extend `frontend/src/features/room-session/lib/session-selectors.ts` so roster, grid, and audio layers derive from the active split-room view.
   - `Main Table` should behave like any other room during a split.
   - Same-room whispers stay visible; off-room whispers are hidden or rejected.
5. Add GM UI without breaking the current layout seams.
   - Add a dedicated split-room control panel under `frontend/src/features/room-session/components/`.
   - Likely touchpoints:
     - `frontend/src/features/room-session/components/RoomTopBar.tsx`
     - `frontend/src/features/room-session/components/SessionSidebar.tsx`
     - `frontend/src/features/room-session/components/ParticipantRoster.tsx`
   - GM capabilities:
     - create, rename, and remove up to 3 side rooms
     - move players between rooms
     - see per-room occupancy
     - focus one room
     - toggle broadcast
     - merge everyone back to the common table
6. Add player-facing split-room feedback.
   - Show current room name and room membership.
   - Show a clear notice when a GM moves the player.
   - Hide off-room participants from visible roster and video grid.
   - Keep whisper affordances only for participants in the same current room.

## Behavioral Rules

- Exactly one GM per session.
- Players not explicitly moved stay in `Main Table`.
- The GM is not assigned like a normal player. The GM remains globally visible and can target audio by focus room or broadcast mode.
- Reconnect restores the last authoritative assignment and split-state snapshot.
- Global spotlight should be suspended during split mode unless we intentionally redesign how spotlight interacts with room isolation.

## Test Plan

- Unit tests:
  - split-state reducers and selectors
  - assignment reconciliation on snapshot restore
  - non-GM command rejection
  - cross-room whisper rejection
  - GM focus and broadcast transitions
- Frontend integration tests:
  - split-aware roster, grid, and audio subscription behavior
  - player move notifications
  - merge back to common table
- Realtime browser validation:
  - use the multi-client flow, not a single browser
  - start simultaneous clients with `pnpm --filter frontend clients:start -- Alice Bob Carol`
  - verify GM + multiple players across `Main Table` and side rooms
  - verify reconnect/refresh restores assignments correctly

## First Implementation Milestone

- Do not start with the GM control panel.
- First land the authority seam:
  - trusted frontend role data
  - split-state contract draft
  - authoritative snapshot/update path
  - tests proving reconnect and non-GM rejection
- Once that exists, the UI and subscription work can be layered on top without rewriting the new room-session architecture again.
