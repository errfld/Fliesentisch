# Room Session Refactor + AGENTS Update

## Summary
Refactor the room screen into a feature-owned structure while keeping the current layout and behavior intact, then update `AGENTS.md` to document the new frontend organization and expectation that `RoomSession.tsx` remains a composition shell.

## Implementation Changes
- Introduce `frontend/src/features/room-session/` as the ownership boundary for this screen.
- Keep `frontend/src/components/RoomSession.tsx` as a thin entry component that wires feature hooks and presentational pieces.
- Add this internal structure:
  - `hooks/`: `useRoomConnection`, `useRoomMedia`, `useWhisperSession`
  - `components/`: `RoomSessionLayout`, `RoomTopBar`, `VideoGrid`, `VideoTile`, `SessionSidebar`, `WhisperPanel`, `ParticipantRoster`, `DevicePanel`, `RemoteAudioLayer`
  - `lib/`: session helpers, formatters, selectors, and derived view-model builders
  - `types.ts`: feature-local view-model and controller types
- Keep shared primitives in place unless already generic:
  - keep `TrackElement` shared
  - keep Zustand whisper store and protocol layer where they are
- Preserve current UX contract:
  - same room props
  - same keyboard shortcuts
  - same important `data-testid` values
  - same visible layout and control labels except for small internal cleanup with no behavior change

## AGENTS.md Update
- Add a short frontend architecture note stating that large screen-specific features should live under `frontend/src/features/<feature-name>/`.
- State that `frontend/src/components/` is for shared/reusable UI primitives, not full screen controllers.
- State that route/session entry components should compose feature hooks/components rather than hold protocol, media, and UI logic together.

## Test Plan
- Run `pnpm --filter frontend lint`
- Run `pnpm --filter frontend typecheck`
- Run `pnpm --filter frontend test`
- Run the existing Playwright multi-client whisper flow and confirm the current room UI still behaves the same

## Assumptions
- Small cleanup in file placement and internal naming is allowed.
- The structure above is the target shape to document in `AGENTS.md`.
