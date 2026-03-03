# Frontend

Next.js client for LiveKit room UI, whispers, and spotlight mode.

## Run

```bash
cp .env.local.example .env.local
pnpm install
pnpm dev
```

## Environment

- `NEXT_PUBLIC_LIVEKIT_URL` (optional): explicit LiveKit WS URL. If omitted, the app uses `ws(s)://<current-host>:7880`.
- `AUTH_SERVICE_URL` (server-only): auth backend base URL used by `/api/v1/token` proxy (default `http://127.0.0.1:8787`).

## Multi-client local smoke test

Use Playwright CLI sessions to open multiple participants on one machine (no LAN HTTPS setup required):

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
