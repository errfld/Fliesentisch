# Infrastructure

Docker Compose setup for local and VPS deployment.

## Services

- `livekit`: SFU server
- `auth`: Rust token service
- `caddy`: reverse proxy

## Run

```bash
cp .env.example .env
docker compose -f docker-compose.yml up -d --build
```

The auth service reads these variables from `infrastructure/.env`:

- Required: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- Optional: `AUTH_BIND_ADDR` (default `0.0.0.0:8787`), `JOIN_SECRET`, `ALLOWED_ROOMS`, `TOKEN_TTL_SECONDS` (default `3600`), `FRONTEND_ORIGINS` (default `http://localhost:3000`)

If auth fails to start, the frontend Vite proxy will surface that as `ECONNREFUSED 127.0.0.1:8787` on `/api/v1/token`.
