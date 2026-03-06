# GM-Controlled Split Rooms

## Summary
- Add a new `Split Mode` that coexists with the current whisper feature.
- During a split, the table is partitioned into the default `Main Table` plus up to 3 GM-named side rooms.
- Players only see and hear participants in their current room, while the GM always sees all players, is visually present to all rooms, and can listen/talk to one focused room at a time or broadcast to all rooms.
- This is a GM-only feature. There is exactly one GM per session, derived from authenticated role data, and split controls must be treated as server-authoritative.
- Reconnects restore each player to their assigned room. The GM ends the split explicitly with a merge action.

## Key Changes
### Roles and trusted state
- Extend session/token/bootstrap data to expose a trusted participant role: `GM | PLAYER`.
- Gate all split-room controls to the GM; non-GM split commands must be rejected or ignored.
- Treat this feature as dependent on the auth/role work, since the current repo does not yet have authenticated session roles.

### Shared split model and protocol
- Add split-state alongside the existing whisper state, not as a replacement.
- Model:
  - `splitActive: boolean`
  - `rooms: [{ id, name, kind: "main" | "side" }]`
  - `assignments: Record<participantIdentity, roomId>`
  - `gmFocusRoomId?: string`
  - `gmBroadcastActive: boolean`
  - `updatedAt`
- GM is a global observer, not a room member.
- Add protocol and snapshot events for:
  - split start and end
  - side-room create, rename, remove
  - player move and reassign
  - GM focus change
  - GM broadcast on and off
- Keep whispers available during split, but only within the participant's current room. Cross-room whispers are disallowed.

### Media and UI behavior
- When split is active, player clients must subscribe only to:
  - audio and video from their assigned room
  - GM video in all cases
  - GM audio only when the GM is focused on their room or broadcasting
- Off-room player tracks must be unsubscribed, not merely hidden or muted.
- `Main Table` behaves like another isolated room during split mode.
- GM UI:
  - create and rename up to 3 side rooms
  - move players between `Main Table` and side rooms
  - see room occupancy at a glance
  - switch focus room
  - toggle global broadcast
  - merge everyone back to the normal table
- Player UI:
  - show current room name and current room members
  - hide off-room participants
  - show a clear notice when the GM moves them
  - keep same-room whisper controls available

## Public Interfaces / Types
- Add trusted role data to the room/session bootstrap path used by the frontend.
- Extend the client protocol with split-room event types and a split snapshot payload.
- Add frontend state types for split rooms, assignments, GM focus, and GM broadcast state.

## Test Plan
- Unit tests for split-state reducers and protocol handling:
  - split start and end
  - room create and rename
  - player reassignment
  - focus changes
  - broadcast toggling
  - reconnect snapshot restoration
  - cross-room whisper rejection
  - non-GM control rejection
- Multi-client Playwright coverage with simultaneous sessions:
  - GM + players split across `Main Table` and 2 side rooms
  - players only see and hear their own room
  - GM sees all players at once
  - only the focused room hears the GM
  - broadcast reaches all rooms without letting players hear each other across rooms
  - moved players get reassignment feedback and their visible/audible participants update immediately
  - refresh and reconnect restores assigned room
  - merge returns everyone to the common table and restores existing behavior
- Use the repo's multi-client flow for realtime validation, not a single-browser test.

## Assumptions and Defaults
- Exactly one GM per session.
- Up to 3 named side rooms, plus the default `Main Table`.
- Players not explicitly moved stay in `Main Table`.
- GM remains visually visible in every room while split mode is active.
- GM broadcast affects only GM outbound audio; player-to-player isolation remains intact.
- Existing global spotlight should be suspended during split mode unless explicitly redesigned later, to avoid breaking room isolation.
