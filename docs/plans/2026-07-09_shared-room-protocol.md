# Shared room protocol implementation plan

1. Add a typed room protocol boundary that owns reliable publishing, envelope encoding/decoding, one LiveKit data listener, and event-type routing.
2. Instantiate the boundary once in `RoomSessionController` and migrate whisper/split feature hooks to register typed handlers while retaining their state-request, snapshot, authority, and reducer behavior.
3. Add unit coverage for whisper/split routing, malformed payload rejection, unsubscribe behavior, and publish results; document the transport lifecycle.
4. Run frontend lint, typecheck, unit tests, build, and multi-client Playwright late-join snapshot checks.
5. Review the diff, commit, push, open a closing PR, and monitor required checks.
