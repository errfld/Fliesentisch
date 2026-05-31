# h3 v2 GA Upgrade Follow-up

## Summary
Track removal of the `h3-v2` `npm:h3@2.0.1-rc.20` pin once TanStack Start and the app's SSR/LiveKit pages are validated against h3 v2 GA.

## Tracking
Tracking ID: H3-V2-GA-2026-05-31

## Acceptance Criteria
- Upstream h3 v2 GA is available.
- `@tanstack/start-server-core` or its consumers are confirmed compatible.
- Frontend typecheck, tests, and end-to-end checks pass after unpinning.
- The `h3-v2` override can be removed from `package.json`.
