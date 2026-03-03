#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
shift || true

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ROOM="${ROOM:-dnd-table-1}"
JOIN_KEY="${JOIN_KEY:-}"
SESSION_PREFIX="${SESSION_PREFIX:-vt-sim}"
CLIENT_COUNT="${CLIENT_COUNT:-3}"
CLIENT_NAMES="${CLIENT_NAMES:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${PLAYWRIGHT_CLI_CONFIG:-$SCRIPT_DIR/playwright-cli.multiclient.config.json}"

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PWCLI="${PWCLI:-$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh}"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required. Install Node.js/npm first."
  exit 1
fi

if [[ ! -x "$PWCLI" ]]; then
  echo "Playwright CLI wrapper not found at: $PWCLI"
  echo "Set PWCLI to your wrapper script path."
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Playwright config not found at: $CONFIG_PATH"
  exit 1
fi

urlencode() {
  node -p "encodeURIComponent(process.argv[1])" -- "$1"
}

resolve_names() {
  local -a resolved=()

  if (( $# > 0 )); then
    resolved=("$@")
  elif [[ -n "$CLIENT_NAMES" ]]; then
    IFS=',' read -r -a resolved <<<"$CLIENT_NAMES"
  else
    local i
    for ((i = 1; i <= CLIENT_COUNT; i += 1)); do
      resolved+=("Player${i}")
    done
  fi

  local -a trimmed=()
  local name
  for name in "${resolved[@]}"; do
    if [[ "$name" == "--" ]]; then
      continue
    fi

    name="$(echo "$name" | xargs)"
    if [[ -n "$name" ]]; then
      trimmed+=("$name")
    fi
  done

  if (( ${#trimmed[@]} == 0 )); then
    echo "No client names resolved. Provide names as args or set CLIENT_NAMES."
    exit 1
  fi

  echo "${trimmed[@]}"
}

start_clients() {
  local -a names
  read -r -a names <<<"$(resolve_names "$@")"

  local room_encoded
  room_encoded="$(urlencode "$ROOM")"

  local idx name session url
  for idx in "${!names[@]}"; do
    name="${names[$idx]}"
    session="${SESSION_PREFIX}-$((idx + 1))"
    url="${BASE_URL%/}/room/${room_encoded}?name=$(urlencode "$name")"

    if [[ -n "$JOIN_KEY" ]]; then
      url="${url}&joinKey=$(urlencode "$JOIN_KEY")"
    fi

    "$PWCLI" --session "$session" close >/dev/null 2>&1 || true
    "$PWCLI" --session "$session" delete-data >/dev/null 2>&1 || true
    "$PWCLI" --session "$session" open "$url" --config "$CONFIG_PATH" --headed >/dev/null
    echo "opened: session=$session name=$name url=$url"
  done
}

stop_clients() {
  local -a names
  read -r -a names <<<"$(resolve_names "$@")"

  local idx session
  for idx in "${!names[@]}"; do
    session="${SESSION_PREFIX}-$((idx + 1))"
    "$PWCLI" --session "$session" close >/dev/null 2>&1 || true
    echo "closed: session=$session"
  done
}

case "$ACTION" in
  start)
    start_clients "$@"
    ;;
  stop)
    stop_clients "$@"
    ;;
  list)
    "$PWCLI" list
    ;;
  *)
    echo "Usage: $(basename "$0") <start|stop|list> [name ...]"
    echo "Examples:"
    echo "  $(basename "$0") start Alice Bob Carol"
    echo "  CLIENT_COUNT=5 $(basename "$0") start"
    echo "  CLIENT_NAMES=Alice,Bob,Carol $(basename "$0") stop"
    exit 1
    ;;
esac
