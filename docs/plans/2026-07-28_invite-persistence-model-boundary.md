# Extract invite persistence and model boundaries

Issue: #222

## Scope

Move invite domain/request-independent models, status policy, token hashing, row decoding, schema initialization, and non-redemption CRUD into private `invites/model.rs` and `invites/store.rs` child modules. Keep `invites.rs` as the stable facade and retain the atomic redemption transaction there for a later focused extraction.

## Constraints

- Preserve router/auth imports and all HTTP paths, payloads, statuses, and errors.
- Preserve `InviteStore` as the coherent capability exposed by `AppState`.
- Do not change SQL schemas, queries, transaction semantics, token format, or visibility beyond the minimum needed between private child modules.
- Keep redemption in one SQL transaction.

## Validation

1. Establish the existing backend test baseline.
2. Keep existing invite behavior tests and add focused model status-policy tests beside the extracted model owner.
3. Run backend formatting, strict all-target Clippy, and the full backend test suite.
4. Review staged and untracked files, verify the facade exports and exact changed-path set, then open a partial `Refs #222` PR.

## Follow-up

Keep #222 open after this slice. The remaining architectural slice is to isolate the atomic redemption transaction behind a focused input/outcome boundary without splitting its SQL transaction.
