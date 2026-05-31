# Continuous Deployment Implementation Plan

Branch: `deploy/continuous-deployment`

## Goal

Deploy the Virtual Table stack to the Hetzner machine at `fliesentisch.rsnfld.de` and make production deployment run automatically after changes land on `main`.

## Confirmed state

- DNS A record exists for `fliesentisch.rsnfld.de` and points to the Hetzner server.
- Local SSH alias `hetzner` works for the administrative user.
- Observed remote host facts:
  - host: `ubuntu-4gb-nbg1-5`
  - current admin login user: `er`
  - key-only SSH as `deploy` works with local key `~/.ssh/fliesentisch-deploy`.
  - Docker Engine is installed: Docker `29.5.2`.
  - Docker Compose plugin is installed: Compose `v5.1.4`.
  - `deploy` is in the `docker` group and can run `docker ps` without sudo.
  - `/opt/virtual-table` and `/opt/virtual-table/infrastructure` are writable by `deploy`.
  - passwordless sudo for `deploy` works.
  - `er` does not have passwordless sudo.
  - UFW is active and allows OpenSSH, `80/tcp`, `443/tcp`, `7881/tcp`, and `50000:50100/udp` for IPv4 and IPv6.
- GitHub repository secrets are configured:
  - `VPS_HOST=fliesentisch.rsnfld.de`
  - `VPS_USER=deploy`
  - `VPS_PORT=22`
  - `VPS_APP_DIR=/opt/virtual-table`
  - `VPS_SSH_KEY` is present.
  - `VITE_LIVEKIT_URL=wss://fliesentisch.rsnfld.de`
  - `VITE_DEFAULT_ROOM=dnd-table-1`
- Existing deploy workflow: `.github/workflows/deploy.yml` builds and pushes GHCR images on `push` to `main`, then SSHes to the VPS if secrets are present.
- VPS compose now has production auth env parity with `infrastructure/docker-compose.yml`.
- Caddyfile now uses `{$CADDY_DOMAIN}` instead of local-only `:80`.
- Caddy now proxies `/rtc*` to `livekit:7880`, so `VITE_LIVEKIT_URL=wss://fliesentisch.rsnfld.de` has a LiveKit signaling route.
- VPS Compose now supplies LiveKit server keys from `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` through `LIVEKIT_KEYS`; the static dev key was removed from `livekit.yaml`.
- The deploy workflow now uploads deployment assets before applying Compose and performs in-network auth/frontend health checks.
- Deployment assets have been copied to `/opt/virtual-table/infrastructure` on the server.
- `docker compose -f infrastructure/docker-compose.vps.yml config` passes on the server with validation-only env values.

## Target state

- A dedicated non-root `deploy` user owns `/opt/virtual-table` and can run Docker without sudo.
- GitHub Actions deploys by SSH as `deploy`.
- Production runs from `/opt/virtual-table/infrastructure/docker-compose.vps.yml`.
- Caddy serves `https://fliesentisch.rsnfld.de` and proxies:
  - frontend app traffic to `frontend:3000`
  - `/api/v1*` to `auth:8787`
  - LiveKit websocket/TCP endpoints as required by the final LiveKit exposure decision.
- Deployments use immutable image tags matching the merge commit SHA.
- Deploy workflow fails if post-deploy health checks fail.

## Implementation phases

### Phase 1: Server bootstrap by administrative user

This phase is complete.

1. Create the deploy user:

   ```bash
   sudo adduser --disabled-password --gecos "" deploy
   ```

2. Install the deploy public key:

   ```bash
   sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   printf '%s\n' '<PASTE_DEPLOY_PUBLIC_KEY_HERE>' | sudo tee /home/deploy/.ssh/authorized_keys >/dev/null
   sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
   sudo chmod 600 /home/deploy/.ssh/authorized_keys
   ```

3. Install Docker Engine and Docker Compose plugin using Docker's Ubuntu repository instructions.

4. Grant Docker access to `deploy`:

   ```bash
   sudo usermod -aG docker deploy
   ```

5. Create the app directory:

   ```bash
   sudo mkdir -p /opt/virtual-table
   sudo chown -R deploy:deploy /opt/virtual-table
   sudo chmod 750 /opt/virtual-table
   ```

6. Verify handoff prerequisites:

   ```bash
   sudo -iu deploy docker ps
   sudo -iu deploy test -w /opt/virtual-table
   ```

7. From local machine, verify key-only deploy access:

   ```bash
   ssh deploy@fliesentisch.rsnfld.de 'docker ps && test -w /opt/virtual-table'
   ```

Phase 1 is complete. The local verification command succeeds and reports Docker `29.5.2`, Docker Compose `v5.1.4`, writable app directories, and passwordless sudo for `deploy`.

### Phase 2: Production configuration files

Implemented repo/server-file changes on `deploy/continuous-deployment`:

1. Updated `infrastructure/docker-compose.vps.yml`:
   - Add missing auth env vars:
     - `AUTH_BASE_URL`
     - `AUTH_COOKIE_SECRET`
     - `AUTH_SESSION_TTL_SECONDS`
     - `AUTH_ENABLE_DEV_LOGIN=false`
     - `GOOGLE_CLIENT_ID`
     - `GOOGLE_CLIENT_SECRET`
     - `TOKEN_TTL_SECONDS`
   - Set `FRONTEND_ORIGINS=https://fliesentisch.rsnfld.de` through `.env`.
   - Add `depends_on` for `frontend -> auth/livekit` and `caddy -> frontend/auth` if not already sufficient.
   - Keep persistent auth data on `auth_data`.

2. Updated `infrastructure/caddy/Caddyfile`:
   - Replace local `:80` site with `{$CADDY_DOMAIN}`.
   - Use `CADDY_DOMAIN=fliesentisch.rsnfld.de` in production.
   - Let Caddy manage HTTPS automatically.
   - Preserve `/api/v1* -> auth:8787` proxying.
   - Proxy `/rtc*` to `livekit:7880` for LiveKit WebSocket signaling.
   - Preserve frontend proxy to `frontend:3000`.

3. Server-side env documentation is captured below. The real server `.env` still needs production secret values and is intentionally not committed.

Required server `.env` under `/opt/virtual-table/infrastructure/.env`:

```dotenv
GITHUB_REPOSITORY_OWNER=errfld
IMAGE_TAG=latest
CADDY_DOMAIN=fliesentisch.rsnfld.de

AUTH_BASE_URL=https://fliesentisch.rsnfld.de
AUTH_COOKIE_SECRET=<long-random-secret>
AUTH_DATABASE_URL=sqlite:///app/data/auth.db?mode=rwc
AUTH_SESSION_TTL_SECONDS=1209600
AUTH_BOOTSTRAP_ADMIN_EMAILS=<admin-email-list>
AUTH_BOOTSTRAP_GAMEMASTER_EMAILS=<gm-email-list>
AUTH_BOOTSTRAP_PLAYER_EMAILS=<player-email-list>
AUTH_ENABLE_DEV_LOGIN=false
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>

LIVEKIT_API_KEY=<livekit-key>
LIVEKIT_API_SECRET=<livekit-secret>
ALLOWED_ROOMS=dnd-table-1
TOKEN_TTL_SECONDS=3600
FRONTEND_ORIGINS=https://fliesentisch.rsnfld.de

AUTH_SERVICE_URL=http://auth:8787
VITE_LIVEKIT_URL=wss://fliesentisch.rsnfld.de
VITE_DEFAULT_ROOM=dnd-table-1
```

### Phase 3: GitHub Actions deployment hardening

Implemented repo changes on `deploy/continuous-deployment`:

1. Keep build-and-push for backend and frontend images.
2. Deploy SHA-tagged images using `github.event.workflow_run.head_sha || github.sha`.
3. Check out the exact SHA being deployed.
4. Copy required deployment files to `${{ secrets.VPS_APP_DIR }}` before running `docker compose`, so the server does not depend on a manually cloned repo.
5. Gate automatic deployment behind successful `CI` completion on `main` via `workflow_run`; `workflow_dispatch` remains available for manual runs.
6. Add remote preflight:
   - verify `docker compose version`
   - verify `/opt/virtual-table` is writable
   - verify expected deployment files exist after sync
   - require server-local `infrastructure/.env`
7. Add remote deploy steps:
   - `docker compose -f infrastructure/docker-compose.vps.yml config`
   - `docker compose -f infrastructure/docker-compose.vps.yml pull`
   - `docker compose -f infrastructure/docker-compose.vps.yml up -d --remove-orphans`
8. Add health checks:
   - auth health via `http://auth:8787/api/v1/health`
   - frontend/Caddy response via `http://caddy/` with host `fliesentisch.rsnfld.de`
9. On failure, print bounded logs:
   - `docker compose -f infrastructure/docker-compose.vps.yml ps`
   - recent logs for `caddy`, `frontend`, `auth`, and `livekit`

### Phase 4: First deploy execution

After Phase 1 server bootstrap and Phase 2/3 repo changes:

1. Build images through GitHub Actions or manually dispatch deploy workflow from the branch if enabled.
2. Create `/opt/virtual-table/infrastructure/.env` on the server with production values and mode `600`:

   ```bash
   ssh deploy@fliesentisch.rsnfld.de 'install -d -m 700 /opt/virtual-table/infrastructure && touch /opt/virtual-table/infrastructure/.env && chmod 600 /opt/virtual-table/infrastructure/.env'
   ```

3. Run compose config validation on the server:

   ```bash
   ssh deploy@fliesentisch.rsnfld.de 'cd /opt/virtual-table && docker compose -f infrastructure/docker-compose.vps.yml config'
   ```

4. Run the deploy.
5. Verify public behavior:
   - `https://fliesentisch.rsnfld.de/` loads.
   - `https://fliesentisch.rsnfld.de/api/v1/health` returns healthy.
   - Google login/session flow works.
   - Token issuance works.
   - A browser can join `dnd-table-1` through LiveKit.

### Phase 5: Merge and continuous deployment verification

1. Open PR from `deploy/continuous-deployment`.
2. Ensure CI is green.
3. Merge to `main`.
4. Verify the deployment workflow deploys the merge commit SHA.
5. Verify the public app still passes the Phase 4 public behavior checks.

## Acceptance criteria

- `ssh deploy@fliesentisch.rsnfld.de 'docker ps && test -w /opt/virtual-table'` succeeds.
- Docker and Docker Compose v2 are installed on the server.
- `/opt/virtual-table` contains only deployment assets and server-local secret `.env`.
- A merge to `main` after passing CI automatically deploys to the Hetzner host.
- Deployed containers use the merge commit SHA image tag.
- `https://fliesentisch.rsnfld.de/` serves the frontend over HTTPS.
- `https://fliesentisch.rsnfld.de/api/v1/health` reports healthy.
- Login/session/token/LiveKit join flows work in production.
- Secrets are not committed and are not printed in GitHub Actions logs.
- Failed deploys fail the workflow and include bounded service diagnostics.

## Current status

Server bootstrap is complete. `/opt/virtual-table/infrastructure/.env` exists, is owned by `deploy:deploy`, has mode `600`, includes all required keys, and validates with `docker compose --env-file infrastructure/.env -f infrastructure/docker-compose.vps.yml config`. The next step is the first real deployment and public browser verification.
