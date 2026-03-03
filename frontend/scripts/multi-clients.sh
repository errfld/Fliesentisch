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
PWCLI_CLOSE_TIMEOUT_SEC="${PWCLI_CLOSE_TIMEOUT_SEC:-10}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${PLAYWRIGHT_CLI_CONFIG:-$SCRIPT_DIR/playwright-cli.multiclient.config.json}"

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PWCLI="${PWCLI:-$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh}"
declare -a PWCLI_CMD=()

if [[ -x "$PWCLI" ]]; then
  PWCLI_CMD=("$PWCLI")
elif command -v playwright_cli.sh >/dev/null 2>&1; then
  PWCLI_CMD=("$(command -v playwright_cli.sh)")
elif command -v playwright-cli >/dev/null 2>&1; then
  PWCLI_CMD=("$(command -v playwright-cli)")
elif command -v npx >/dev/null 2>&1; then
  PWCLI_CMD=(npx --yes --package @playwright/cli playwright-cli)
fi

if (( ${#PWCLI_CMD[@]} == 0 )); then
  echo "Playwright CLI runner is unavailable."
  echo "Expected wrapper: \$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
  echo "Set PWCLI to an executable playwright_cli.sh path, install playwright-cli on PATH,"
  echo "or install Node.js/npm so the script can fall back to npx @playwright/cli."
  exit 1
fi

urlencode() {
  node -p "encodeURIComponent(process.argv[1])" -- "$1"
}

run_pwcli() {
  "${PWCLI_CMD[@]}" "$@"
}

close_session() {
  local session="$1"
  run_pwcli --session "$session" close >/dev/null 2>&1 &
  local close_pid=$!
  local waited=0

  while kill -0 "$close_pid" 2>/dev/null; do
    if (( waited >= PWCLI_CLOSE_TIMEOUT_SEC )); then
      kill "$close_pid" >/dev/null 2>&1 || true
      wait "$close_pid" >/dev/null 2>&1 || true
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  wait "$close_pid" >/dev/null 2>&1 || true
  return 0
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
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "Playwright config not found at: $CONFIG_PATH"
    exit 1
  fi

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

    close_session "$session" || true
    run_pwcli --session "$session" delete-data >/dev/null 2>&1 || true
    run_pwcli --session "$session" open "$url" --config "$CONFIG_PATH" --headed >/dev/null
    echo "opened: session=$session name=$name url=$url"
  done
}

stop_clients() {
  local -a sessions=()
  local session
  while IFS= read -r session; do
    if [[ -n "$session" ]]; then
      sessions+=("$session")
    fi
  done < <(
    run_pwcli list 2>/dev/null | awk -v prefix="${SESSION_PREFIX}-" '
      /^- / {
        name = $0;
        sub(/^- /, "", name);
        sub(/:$/, "", name);
        if (index(name, prefix) == 1) {
          print name;
        }
      }
    '
  )

  if (( ${#sessions[@]} == 0 )); then
    echo "No running sessions found for prefix: ${SESSION_PREFIX}-"
    return 0
  fi

  for session in "${sessions[@]}"; do
    if close_session "$session"; then
      echo "closed: session=$session"
    else
      echo "close timed out: session=$session (continuing)"
    fi
  done
}

case "$ACTION" in
  start)
    start_clients "$@"
    ;;
  stop)
    stop_clients
    ;;
  list)
    run_pwcli list
    ;;
  *)
    echo "Usage: $(basename "$0") <start|stop|list> [name ...]"
    echo "Examples:"
    echo "  $(basename "$0") start Alice Bob Carol"
    echo "  CLIENT_COUNT=5 $(basename "$0") start"
    echo "  SESSION_PREFIX=vt-sim $(basename "$0") stop"
    exit 1
    ;;
esac
