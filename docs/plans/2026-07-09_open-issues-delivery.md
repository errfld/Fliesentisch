# Open issues delivery plan

Scope: implement every open issue in `errfld/Fliesentisch` except caretaker log #138, validate each change, publish focused pull requests, and monitor them through merge.

## Delivery sequence

1. Complete the backend HTTP boundary extraction (#162).
2. Stabilize room-session view models, panel contracts, and the shared data-channel transport (#133, #134, #136).
3. Add persisted campaign presets followed by constrained role-scoped invite links (#128, #131).
4. Add the session lobby, GM handout spotlight, and in-room diagnostics (#127, #129, #130).
5. Re-review every branch, run the repository's backend/frontend/security and multi-client Playwright gates, address review feedback, and merge only when required checks pass.

## Cross-cutting constraints

- Preserve existing Google-auth and dev-login paths.
- Never grant admin or gamemaster privileges through player invite redemption.
- Keep route/session entries thin and screen-specific frontend code under `frontend/src/features`.
- Validate all realtime changes with simultaneous isolated browser sessions.
- Do not use `unwrap` in production Rust code.
