#!/usr/bin/env bash
# Start local memgrep services:
#   build → MCP token → Telegram LaunchAgent (--all) → jobs LaunchAgent → local MCP if needed
# Usage: npm start   (or ./scripts/start-all.sh)
# Does not start or manage a public tunnel — set MEMGREP_PUBLIC_URL yourself if needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEMGREP_HOME="${MEMGREP_HOME:-$HOME/.memgrep}"
RUN_DIR="$MEMGREP_HOME/tunnel"
PORT="${MEMGREP_TUNNEL_PORT:-3921}"
HOST="${MEMGREP_TUNNEL_HOST:-127.0.0.1}"
TOKEN_FILE="$MEMGREP_HOME/mcp-token"
CLI="$ROOT/dist/cli.js"
SERVE_LOG="$RUN_DIR/serve.log"
SERVE_PID_FILE="$RUN_DIR/serve.pid"
CAFFEINATE_PID_FILE="$RUN_DIR/caffeinate.pid"

mkdir -p "$RUN_DIR" "$MEMGREP_HOME/logs"
umask 077

# Optional local overrides (gitignored). Does not commit secrets.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
  fi
}

already_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(tr -d '[:space:]' <"$pid_file")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

ensure_token() {
  if [[ -f "$TOKEN_FILE" ]] && [[ -s "$TOKEN_FILE" ]]; then
    return
  fi
  need_cmd openssl
  log "Creating MCP bearer token → $TOKEN_FILE"
  openssl rand -hex 24 >"$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
}

ensure_build() {
  if [[ ! -f "$CLI" ]]; then
    log "Building memgrep (dist/ missing)…"
    (cd "$ROOT" && npm run build)
    return
  fi
  if find "$ROOT/src" -type f -name '*.ts' -newer "$CLI" 2>/dev/null | grep -q .; then
    log "Building memgrep (sources newer than dist)…"
    (cd "$ROOT" && npm run build)
  fi
}

export_token() {
  MEMGREP_MCP_TOKEN="$(tr -d '\n' <"$TOKEN_FILE")"
  export MEMGREP_MCP_TOKEN
  [[ -n "$MEMGREP_MCP_TOKEN" ]] || die "empty token in $TOKEN_FILE"
  export MEMGREP_MCP_URL="http://${HOST}:${PORT}/mcp"
  # Pass through optional public-tunnel allowlist env if the user set them.
  # This script never starts a tunnel process.
}

start_telegram() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    log "Non-macOS: starting telegram --all in background…"
    if already_running "$RUN_DIR/telegram.pid"; then
      log "telegram already running (pid $(cat "$RUN_DIR/telegram.pid"))"
      return
    fi
    nohup env MEMGREP_MCP_TOKEN="$MEMGREP_MCP_TOKEN" MEMGREP_MCP_URL="$MEMGREP_MCP_URL" \
      node "$CLI" telegram --all >>"$MEMGREP_HOME/logs/telegram.log" 2>&1 &
    echo $! >"$RUN_DIR/telegram.pid"
    return
  fi

  log "Installing / restarting Telegram LaunchAgent (all profiles)…"
  if ! node "$CLI" telegram install --all; then
    die "telegram install failed — run: node dist/cli.js telegram setup"
  fi
}

start_jobs() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    log "Non-macOS: starting jobs daemon in background…"
    if already_running "$RUN_DIR/jobs.pid"; then
      log "jobs already running (pid $(cat "$RUN_DIR/jobs.pid"))"
      return
    fi
    nohup env MEMGREP_MCP_TOKEN="$MEMGREP_MCP_TOKEN" MEMGREP_MCP_URL="$MEMGREP_MCP_URL" \
      node "$CLI" jobs daemon >>"$MEMGREP_HOME/logs/jobs.log" 2>&1 &
    echo $! >"$RUN_DIR/jobs.pid"
    return
  fi

  log "Installing / restarting jobs LaunchAgent…"
  node "$CLI" jobs install
}

wait_for_mcp() {
  log "Waiting for MCP on :$PORT …"
  for _ in $(seq 1 60); do
    if port_in_use "$PORT"; then
      log "MCP listening on http://${HOST}:${PORT}/mcp"
      return
    fi
    sleep 0.25
  done
  log "warning: nothing listening on :$PORT yet — check ~/.memgrep/logs/telegram-launchd.log"
}

start_serve_fallback() {
  if port_in_use "$PORT"; then
    return
  fi
  if already_running "$SERVE_PID_FILE"; then
    return
  fi
  log "No MCP on :$PORT — starting standalone serve --http …"
  (
    cd "$ROOT"
    nohup env MEMGREP_MCP_TOKEN="$MEMGREP_MCP_TOKEN" \
      node "$CLI" serve --http --host "$HOST" --port "$PORT" \
      >>"$SERVE_LOG" 2>&1 &
    echo $! >"$SERVE_PID_FILE"
  )
  wait_for_mcp
}

CAFFEINATE_LABEL="com.memgrep.caffeinate"

write_launch_agent() {
  local label="$1"
  local log_path="$2"
  shift 2
  local plist="$HOME/Library/LaunchAgents/${label}.plist"
  local args_xml=""
  local arg
  for arg in "$@"; do
    args_xml+="    <string>$(printf '%s' "$arg" | sed 's/&/\&amp;/g;s/</\&lt;/g;s/>/\&gt;/g')</string>"$'\n'
  done
  mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$log_path")"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args_xml}  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${log_path}</string>
  <key>StandardErrorPath</key>
  <string>${log_path}</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl kickstart -k "gui/$(id -u)/${label}"
}

start_caffeinate() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return
  fi
  if ! command -v caffeinate >/dev/null 2>&1; then
    log "warning: caffeinate not found — Mac may sleep and pause Telegram polling"
    return
  fi
  log "Installing caffeinate LaunchAgent (prevent idle sleep)…"
  write_launch_agent "$CAFFEINATE_LABEL" "$RUN_DIR/caffeinate.log" "$(command -v caffeinate)" -im
}

print_status() {
  local token_preview
  token_preview="$(head -c 6 "$TOKEN_FILE")…"

  echo
  echo "────────────────────────────────────────────────────────"
  echo "memgrep: local services"
  echo
  if [[ "$(uname -s)" == "Darwin" ]]; then
    node "$CLI" telegram service 2>/dev/null || true
    echo
    node "$CLI" jobs service 2>/dev/null || true
    echo
  fi
  cat <<EOF
  MCP local : http://${HOST}:${PORT}/mcp
  Token file: ${TOKEN_FILE} (${token_preview})
  Public tunnel: not managed (set MEMGREP_PUBLIC_URL if you run your own)
  Logs:
    telegram → ~/.memgrep/logs/telegram-launchd.log
    jobs     → ~/.memgrep/logs/jobs-launchd.log

Stop everything:  npm stop
────────────────────────────────────────────────────────
EOF
}

# ── main ──────────────────────────────────────────────
need_cmd node
need_cmd npm
ensure_build
ensure_token
export_token

# Legacy cleanup: old installs registered a vendor-specific tunnel LaunchAgent.
if [[ "$(uname -s)" == "Darwin" ]]; then
  launchctl bootout "gui/$(id -u)/com.memgrep.ngrok" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.memgrep.ngrok.plist"
fi
rm -f "$RUN_DIR/ngrok.pid" "$RUN_DIR/ngrok.log"

if ! node "$CLI" cursor status 2>/dev/null | grep -q 'Cursor MCP: configured'; then
  log "warning: Cursor MCP not configured — run: node dist/cli.js cursor setup"
fi

start_caffeinate
start_telegram
start_jobs
wait_for_mcp
start_serve_fallback
print_status
