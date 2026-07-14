#!/usr/bin/env bash
# Start everything memgrep needs locally:
#   build → MCP token → Telegram LaunchAgent (--all) → jobs LaunchAgent → ngrok tunnel
# Usage: npm start   (or ./scripts/start-all.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEMGREP_HOME="${MEMGREP_HOME:-$HOME/.memgrep}"
RUN_DIR="$MEMGREP_HOME/tunnel"
PORT="${MEMGREP_TUNNEL_PORT:-3921}"
HOST="${MEMGREP_TUNNEL_HOST:-127.0.0.1}"
TOKEN_FILE="$MEMGREP_HOME/mcp-token"
URL_FILE="$MEMGREP_HOME/mcp-public-url"
CLI="$ROOT/dist/cli.js"
SERVE_LOG="$RUN_DIR/serve.log"
NGROK_LOG="$RUN_DIR/ngrok.log"
SERVE_PID_FILE="$RUN_DIR/serve.pid"
NGROK_PID_FILE="$RUN_DIR/ngrok.pid"
CAFFEINATE_PID_FILE="$RUN_DIR/caffeinate.pid"

mkdir -p "$RUN_DIR" "$MEMGREP_HOME/logs"
umask 077

# Optional local overrides (e.g. MEMGREP_NGROK_DOMAIN). Does not commit secrets.
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

resolve_domain() {
  # Prefer env (or .env), then ~/.memgrep/mcp-public-url. No hardcoded personal domain.
  local raw="${MEMGREP_NGROK_DOMAIN:-}"
  if [[ -z "$raw" && -f "$URL_FILE" ]]; then
    raw="$(tr -d '\n' <"$URL_FILE")"
  fi
  if [[ -z "$raw" ]]; then
    die "Set MEMGREP_NGROK_DOMAIN (e.g. in .env) or write https://YOUR-subdomain.ngrok-free.app/mcp to $URL_FILE"
  fi
  # Accept bare host or full URL.
  if [[ "$raw" == https://* || "$raw" == http://* ]]; then
    sed -E 's#^https?://([^/]+)/?.*#\1#' <<<"$raw" | tr -d '\n'
  else
    printf '%s' "$raw" | tr -d '\n' | sed -E 's#/.*##'
  fi
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
  # So MCP Host-header checks accept the ngrok domain (DNS rebinding protection).
  local domain
  domain="$(resolve_domain)"
  export MEMGREP_NGROK_DOMAIN="$domain"
  export MEMGREP_ALLOWED_HOSTS="${MEMGREP_ALLOWED_HOSTS:-$domain}"
  printf '%s\n' "https://${domain}/mcp" >"$URL_FILE"
  chmod 600 "$URL_FILE"
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
  # Re-install so plist picks up current dist/ + MEMGREP_MCP_TOKEN
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
  # Only if Telegram did not bind MCP (e.g. install failed partially).
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

NGROK_LABEL="com.memgrep.ngrok"
CAFFEINATE_LABEL="com.memgrep.caffeinate"

write_launch_agent() {
  # $1=label $2=program path $3=arg2 $4=arg3... via remaining; log path last? 
  # Simpler: label, log, and program args as separate.
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
    log "warning: caffeinate not found — Mac may sleep and drop the tunnel"
    return
  fi
  log "Installing caffeinate LaunchAgent (prevent idle sleep)…"
  write_launch_agent "$CAFFEINATE_LABEL" "$RUN_DIR/caffeinate.log" "$(command -v caffeinate)" -im
}

start_ngrok() {
  need_cmd ngrok
  local domain public_url ngrok_bin
  domain="$(resolve_domain)"
  public_url="https://${domain}/mcp"
  ngrok_bin="$(command -v ngrok)"
  printf '%s\n' "$public_url" >"$URL_FILE"
  chmod 600 "$URL_FILE"

  # Clear any leftover foreground ngrok from older scripts
  pkill -f "ngrok http ${PORT}" 2>/dev/null || true
  pkill -f 'ngrok start memgrep' 2>/dev/null || true
  rm -f "$NGROK_PID_FILE"

  if [[ "$(uname -s)" == "Darwin" ]]; then
    log "Installing ngrok LaunchAgent → $public_url …"
    write_launch_agent "$NGROK_LABEL" "$NGROK_LOG" \
      "$ngrok_bin" http "$PORT" --url="$domain" --log=stdout
  else
    log "Starting ngrok → $public_url …"
    nohup "$ngrok_bin" http "$PORT" --url="$domain" --log=stdout >>"$NGROK_LOG" 2>&1 &
    echo $! >"$NGROK_PID_FILE"
  fi

  local ok=0
  for _ in $(seq 1 50); do
    if curl -sS --max-time 1 "http://127.0.0.1:4040/api/tunnels" 2>/dev/null \
      | grep -q "$domain"; then
      ok=1
      break
    fi
    sleep 0.25
  done
  if [[ "$ok" != "1" ]]; then
    die "ngrok failed to come online — see $NGROK_LOG"
  fi
  log "ngrok ready"
}

verify_public_mcp() {
  local domain token
  domain="$(resolve_domain)"
  token="$(tr -d '\n' <"$TOKEN_FILE")"
  log "Verifying public MCP https://${domain}/mcp …"
  local code=""
  local attempt
  for attempt in 1 2 3 4 5; do
    code="$(
      curl -sS -o /tmp/memgrep-mcp-probe.out -w '%{http_code}' --max-time 25 \
        -H "ngrok-skip-browser-warning: true" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"memgrep-start","version":"0.0.1"}}}' \
        "https://${domain}/mcp" 2>/dev/null || echo '000'
    )"
    if [[ "$code" == "200" ]] && grep -q 'memgrep' /tmp/memgrep-mcp-probe.out 2>/dev/null; then
      log "Public MCP OK (HTTP $code)"
      return
    fi
    sleep 1
  done
  log "warning: public MCP probe returned HTTP ${code} — see /tmp/memgrep-mcp-probe.out"
  log "         If clients see ETIMEDOUT, their network may block ngrok (VPN often fixes it)."
}

print_status() {
  local domain token_preview
  domain="$(resolve_domain)"
  token_preview="$(head -c 6 "$TOKEN_FILE")…"

  echo
  echo "────────────────────────────────────────────────────────"
  echo "memgrep: all services"
  echo
  if [[ "$(uname -s)" == "Darwin" ]]; then
    node "$CLI" telegram service 2>/dev/null || true
    echo
    node "$CLI" jobs service 2>/dev/null || true
    echo
  fi
  cat <<EOF
  MCP local : http://${HOST}:${PORT}/mcp
  MCP public: https://${domain}/mcp
  Token file: ${TOKEN_FILE} (${token_preview})
  Logs:
    telegram → ~/.memgrep/logs/telegram-launchd.log
    jobs     → ~/.memgrep/logs/jobs-launchd.log
    ngrok    → ${NGROK_LOG}

Stop everything:  npm stop

Client mcp.json (paste token: cat ${TOKEN_FILE}):
{
  "mcpServers": {
    "memgrep-tunnel": {
      "url": "https://${domain}/mcp",
      "headers": {
        "Authorization": "Bearer <paste from ${TOKEN_FILE}>"
      }
    }
  }
}
────────────────────────────────────────────────────────
EOF
}

# ── main ──────────────────────────────────────────────
need_cmd node
need_cmd npm
ensure_build
ensure_token
export_token

if ! node "$CLI" cursor status 2>/dev/null | grep -q 'Cursor MCP: configured'; then
  log "warning: Cursor MCP not configured — run: node dist/cli.js cursor setup"
fi

start_caffeinate
start_telegram
start_jobs
wait_for_mcp
start_serve_fallback
start_ngrok
verify_public_mcp
print_status
