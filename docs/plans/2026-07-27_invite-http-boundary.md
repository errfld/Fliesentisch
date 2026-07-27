# Extract invite HTTP adapter boundary

Issue: #222

## Scope

Move Axum extractors, request/response DTOs, invite-manager authorization, request validation, and store-error-to-HTTP mapping from `backend/src/invites.rs` into a private `invites/handlers.rs` child module. Keep `invites.rs` as the existing facade so router/auth callers and all public HTTP behavior remain unchanged.

## Validation

1. Establish the existing backend test baseline.
2. Add a structural unit test proving invite request validation belongs to the handler module.
3. Run backend format, strict Clippy, and full backend tests.
4. Review the complete staged diff and verify the router-facing facade exports remain stable.

## Follow-up

Keep #222 open: later slices still need to separate persistence models and the atomic redemption transaction while preserving one SQL transaction.
