# Frontend

TanStack Start (React) client for LiveKit room UI, whispers, and spotlight mode.

## Run

```bash
cp .env.local.example .env.local
pnpm install
pnpm dev
```

## Environment

- `VITE_LIVEKIT_URL` (optional): explicit LiveKit WS URL. If omitted, the app uses `ws(s)://<current-host>:7880`.
- `VITE_DEFAULT_ROOM` (optional): prefilled room value on join form (`dnd-table-1` by default).
- `VITE_JOIN_KEY` (optional): prefilled join key value on join form.
- `AUTH_SERVICE_URL` (dev proxy): auth backend base URL used by Vite dev server to proxy `/api/v1/*` (default `http://127.0.0.1:8787`).

If `/api/v1/token` proxy requests fail with `ECONNREFUSED 127.0.0.1:8787`, the auth backend is down. In local Docker-based dev, rerun `pnpm compose:up` and make sure `infrastructure/.env` sets `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.

## Simple Auth

The home page now supports a small backend-owned auth flow:

- sign in with an allowlisted email
- backend sets a signed session cookie
- `/api/v1/token` returns `game_role` when that session exists

This is a transition path, not the final OAuth flow:

- email ownership is not verified yet
- legacy join-key entry still works when no session is present

## Multi-client local smoke test

Use Playwright CLI sessions to open multiple participants on one machine (no LAN HTTPS setup required):

Setup:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --help
```

- Expected wrapper path: `$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh`
- If `PWCLI` is unset or not executable, `multi-clients.sh` falls back to:
  - `playwright_cli.sh` on `PATH`
  - then `playwright-cli` on `PATH`
  - then `npx --yes --package @playwright/cli playwright-cli` (requires Node.js/npm)

```bash
# default: 3 clients (Player1..Player3) in room dnd-table-1
pnpm clients:start

# explicit names
pnpm clients:start -- Alice Bob Carol

# custom room and count
ROOM=my-room CLIENT_COUNT=5 pnpm clients:start

# close the spawned sessions
pnpm clients:stop
```

Notes:
- Run the app locally (`pnpm dev`) before starting clients.
- This launcher uses fake media devices and auto-grants mic/camera permissions to avoid prompt friction.

## E2E

Run Playwright whisper e2e tests (multi-client, selection, `V`/`G` flows).
Run these commands from the repository root.

```bash
cp infrastructure/.env.example infrastructure/.env
pnpm --filter frontend test:e2e:install
pnpm --filter frontend test:e2e
```

Optional:

- `E2E_BASE_URL` (default `http://127.0.0.1:3100`)
- `E2E_ROOM` (default `dnd-table-1`)
