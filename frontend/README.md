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
