# Simple Auth Phase 1

## Goal
- Add a very small backend-owned auth path now, without waiting for Google OAuth.
- Keep it compatible with the later backend session model instead of inventing a frontend-owned auth system.

## Phase 1 Shape
- Backend login endpoint accepts an allowlisted email and sets a signed session cookie.
- Backend session endpoint returns the current user email and roles from that cookie.
- Backend token endpoint returns trusted `game_role` when a session exists.
- Legacy join-key room entry remains available for now so current room flows and tests do not break during migration.

## Deliberate Limits
- This is not a production-grade identity proof flow.
- Email ownership is not verified yet.
- LiveKit identity is still client-generated in this phase.
- GM authority is still not fully trusted until authenticated identity, not just role, reaches the token path.

## Why This Slice
- It gives the frontend a real session to build against.
- It exercises the backend-owned auth/session architecture planned for OAuth.
- It lets split-mode work start consuming trusted role data without blocking on Google setup.
