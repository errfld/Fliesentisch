# Infrastructure

Docker Compose setup for local and VPS deployment.

## Services

- `livekit`: SFU server
- `auth`: Rust token service
- `caddy`: reverse proxy

## Run

```bash
cp .env.example .env
docker compose -f docker-compose.yml up -d
```

For local Vite-based development, set `APP_BASE_URL=http://localhost:3000` in `infrastructure/.env`. If auth fails to start, the frontend Vite proxy will surface that as `ECONNREFUSED 127.0.0.1:8787` on `/api/v1/token`.
