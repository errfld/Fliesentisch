# Split Mode Phase 2

## Goal
- Move split mode from readonly state to a usable GM-controlled workflow.

## Scope
1. Add frontend helpers for initial split-state creation and side-room creation defaults.
2. Publish split control events over the existing LiveKit data channel.
3. Add a minimal GM-only sidebar panel to:
   - start split mode
   - add or remove side rooms
   - assign participants to rooms
   - set GM focus room
   - toggle GM broadcast
   - merge the table back together
4. Keep the authority model intentionally simple for now:
   - only authenticated `gamemaster` clients can issue commands in the UI
   - data-channel messages are still cooperative, not server-authoritative

## Constraints
- Do not redesign transport or media routing in this slice.
- Do not build a polished room-management UX yet; optimize for a workable control surface.
- Preserve current room behavior when split mode is inactive.

## Exit Criteria
- A signed-in GM can start split mode and publish follow-up room/assignment/focus/broadcast events.
- Non-GM participants react to the resulting split state without seeing management controls.
- The flow is verified with multiple simultaneous browser sessions.
