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
- `AUTH_SERVICE_URL` (dev/preview proxy): auth backend base URL used to proxy `/api/v1/*` (default `http://127.0.0.1:8787`).
