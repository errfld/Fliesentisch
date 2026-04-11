#!/usr/bin/env bash
set -euo pipefail

export AUTH_BASE_URL="${AUTH_BASE_URL:-http://127.0.0.1:3100}"
export AUTH_COOKIE_SECRET="${AUTH_COOKIE_SECRET:-e2e-cookie-secret}"
export AUTH_ENABLE_DEV_LOGIN="${AUTH_ENABLE_DEV_LOGIN:-true}"
export AUTH_BOOTSTRAP_ADMIN_EMAILS="${AUTH_BOOTSTRAP_ADMIN_EMAILS:-gm@example.com}"
export AUTH_BOOTSTRAP_GAMEMASTER_EMAILS="${AUTH_BOOTSTRAP_GAMEMASTER_EMAILS:-gm@example.com}"
export AUTH_BOOTSTRAP_PLAYER_EMAILS="${AUTH_BOOTSTRAP_PLAYER_EMAILS:-alice@example.com,bob@example.com,carol@example.com}"
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-e2e-client}"
export GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-e2e-secret}"
export FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-http://127.0.0.1:3100}"
export LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkey}"
export LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-devsecret}"

pnpm --dir .. compose:up
playwright test -c playwright.config.ts "$@"
