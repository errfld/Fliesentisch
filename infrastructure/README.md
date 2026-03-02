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
