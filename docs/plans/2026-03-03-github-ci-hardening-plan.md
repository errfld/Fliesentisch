# GitHub CI Hardening Plan (Tests + Lint + Security + Merge Gate)

## Summary
Create one authoritative CI workflow that runs all feasible checks for this repo on every PR, blocks merging unless all checks pass, and adds free/open-source dependency security scanning for both TypeScript and Rust.

## Public Interface/Contract Changes
- New required GitHub check contract: `CI / merge-gate` (single status check used by branch protection).
- Deprecated workflow checks from:
  - `.github/workflows/frontend.yml`
  - `.github/workflows/backend.yml`
- New workflow file:
  - `.github/workflows/ci.yml`
- New dependency update config:
  - `.github/dependabot.yml`

## Implementation Plan
1. Save this plan as a dated plan doc in `docs/plans`.
2. Add `.github/workflows/ci.yml` with triggers:
   - `pull_request` (all branches, no path filters)
   - `push` on `main`
   - `merge_group` (so merge queue also enforces checks)
   - `concurrency` enabled per ref to cancel stale runs
3. Define CI jobs in `ci.yml`:
   - `frontend_infra_checks`:
     - `actions/checkout@v4`
     - `actions/setup-node@v4` with Node 20 and pnpm cache
     - `corepack enable`
     - `pnpm install --frozen-lockfile`
     - `pnpm --filter frontend lint`
     - `pnpm --filter frontend typecheck`
     - `pnpm --filter frontend test`
     - `pnpm --filter frontend build`
     - `pnpm --filter infrastructure lint`
     - `pnpm --filter infrastructure test`
   - `backend_checks`:
     - `actions/checkout@v4`
     - `dtolnay/rust-toolchain@stable` with `rustfmt,clippy`
     - `cargo fmt --manifest-path backend/Cargo.toml -- --check`
     - `cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings`
     - `cargo test --manifest-path backend/Cargo.toml`
     - `cargo build --manifest-path backend/Cargo.toml --locked`
   - `security_js`:
     - `actions/checkout@v4`
     - Node/pnpm setup + install
     - `pnpm audit --audit-level high`
     - `actions/dependency-review-action@v4` on PRs with `fail-on-severity: high`
   - `security_rust`:
     - `actions/checkout@v4`
     - Rust toolchain setup
     - install `cargo-audit` via `taiki-e/install-action@cargo-audit`
     - `cargo audit --file backend/Cargo.lock`
   - `merge-gate`:
     - `needs` all jobs above
     - `if: always()`
     - fail unless every needed job result is `success`
4. Remove old split workflows:
   - delete `.github/workflows/frontend.yml`
   - delete `.github/workflows/backend.yml`
5. Keep `.github/workflows/deploy.yml` unchanged.
6. Add `.github/dependabot.yml` (free GitHub-native) for weekly npm + cargo dependency update PRs.

## Branch Protection (Required for “only allow merge if passing”)
1. In GitHub branch protection/ruleset for `main`, enable:
   - Require pull request before merging
   - Require status checks to pass
   - Require branch to be up to date
   - Restrict direct pushes to `main`
2. Add required check:
   - `CI / merge-gate`

## Test Cases and Scenarios
1. PR with TS lint error in `frontend` must fail `frontend_infra_checks` and `merge-gate`.
2. PR with Rust clippy warning must fail `backend_checks` and `merge-gate`.
3. PR introducing high-severity npm vulnerability must fail `security_js` and `merge-gate`.
4. PR with vulnerable Rust crate in `backend/Cargo.lock` must fail `security_rust` and `merge-gate`.
5. Clean PR must pass all jobs and show `CI / merge-gate` green.
6. PR touching only docs must still run CI (no path-filter bypass).
7. Merge queue run must execute CI via `merge_group`.

## Assumptions and Defaults Chosen
- Security policy: block on `High/Critical` vulnerabilities.
- Build policy: require app builds (`frontend build` + `cargo build`), not Docker image builds in PR CI.
- Required-check model: single aggregate required check (`CI / merge-gate`).
- Tooling remains fully open-source/free (GitHub Actions + OSS scanners).
