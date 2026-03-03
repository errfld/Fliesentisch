# Virtual Table

## What to do
Save created plans **ALWAYS** in `docs/plans` folder.

For frontend-impacting changes, validate behavior with Playwright before finishing.

For realtime/frontend flows, test with multiple simultaneous browser sessions (not a single client only).

Use `pnpm --filter frontend clients:start -- Alice Bob Carol` (or equivalent multi-session setup) for multi-client checks.

## What NOT to do
