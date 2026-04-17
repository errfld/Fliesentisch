# Virtual Table

## What to do
- Save created plans **ALWAYS** in `docs/plans` folder. Save them with the pattern: 'yyyy-mm-dd_short-description'

### Frontend Architecture
- Frontend typescript code is stored under: `frontend`. 
- Put large screen-specific features under `frontend/src/features/<feature-name>/`.
- Keep `frontend/src/components/` for shared, reusable UI primitives rather than full-screen controllers.
- Keep route/session entry components thin: compose feature hooks and feature components instead of combining protocol, media, store, and UI logic in one file.

### Frontend Technology
- typescript single page application using react and tan-stack-start 

### Backend
- Backend rust code is stored under: `backend` 
- Managing auth, users and roles. But not limited to it for future purposes

### Infra
- Infrastructure can be found under: `infrastructure` 
- We use LiveKit as a server to manage audio, video and rooms. <D-s>

### PRs
- before publishing a PR, review your changes again and fix issues proactively. Ask for clarification if in doubt.
- create PR title in the format: 'type(module): short description' for example: "fix(Caddy): add missing env var"
- create concise PR descriptions

For frontend-impacting changes, validate behavior with Playwright before finishing.

For realtime/frontend flows, test with multiple simultaneous browser sessions (not a single client only).

Use `pnpm --filter frontend clients:start -- Alice Bob Carol` (or equivalent multi-session setup) for multi-client checks.

## What NOT to do

### Rust
- do NOT use 'unwrap' in production code<D-s>
