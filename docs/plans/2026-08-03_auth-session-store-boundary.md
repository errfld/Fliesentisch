# Authentication session-store boundary

## Goal

Resolve issue #242 by moving authentication-session schema and lifecycle persistence out of `UserStore` without changing cookie, route, expiry, active-user, or logout behavior.

## Implementation

1. Establish the current session-store test as a behavior baseline and an architectural RED for the missing focused boundary.
2. Add a crate-private `SessionStore` over the existing SQLite pool and move session table initialization plus create/get/delete operations into it.
3. Expose `SessionStore` through `AppState`; route authentication and logout persistence through that narrow dependency.
4. Move and expand focused tests for active, expired, deleted, inactive-user, and reconnect/persistence behavior while retaining router-level session coverage.
5. Run backend formatting, strict Clippy, all-target tests, structural ownership checks, and self-review before publishing.
