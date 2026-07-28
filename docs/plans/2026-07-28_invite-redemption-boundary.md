# Extract invite redemption boundary

Issue: #222

## Scope

Move the cross-aggregate invite redemption workflow into a private `invites/redemption.rs` child module with a focused input type and existing `RedeemedInvite` outcome. Keep `InviteStore::redeem_invite` as the source-compatible facade method.

## Constraints

- Preserve one database transaction for identity lookup/reactivation, invite consumption, redemption recording, campaign membership, and restricted-user bookkeeping.
- Preserve idempotency, max-use enforcement, identity mismatch behavior, privileged-user protection, SQL statements, HTTP behavior, and user-visible errors.
- Keep `AppState`, router, auth, and handler imports unchanged.
- Do not expose SQLx transaction or backend details outside the private invite module.

## Validation

1. Retain the existing end-to-end invite redemption tests as the behavior contract.
2. Use compile/strict-Clippy feedback to validate the new child-module visibility boundary.
3. Run backend formatting, strict all-target Clippy, and the full backend test suite.
4. Review the exact changed-path set and facade delegation before opening a `Refs #222` PR.

## Completion

This is the final planned #222 ownership slice. After green hosted checks and merge, close #222 with the merged PR and validation evidence.
