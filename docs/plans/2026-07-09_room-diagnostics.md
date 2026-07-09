# In-room diagnostics implementation plan

1. Add pure diagnostic snapshot, network-health, subscription, identifier, and redacted-summary helpers with focused unit tests.
2. Add a room diagnostics hook for connection/reconnect history, LiveKit quality and receiver stats, local mic activity, device labels, and track subscription state.
3. Add an accessible signal-ledger diagnostics drawer, expose it to every participant from the room top bar, and wire clipboard feedback through the room-session view model.
4. Add a multi-client Playwright flow that opens the panel and verifies safe room/client and subscription information.
5. Run pnpm 10.30.3 lint, typecheck, tests, build, and Playwright; review, commit, publish the PR, address feedback, and merge after CI passes.
