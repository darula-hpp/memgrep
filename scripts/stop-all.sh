#!/usr/bin/env bash
# Stop tunnel + Telegram/jobs (LaunchAgents on macOS, background PIDs elsewhere).
set -euo pipefail

MEMGREP_HOME="${MEMGREP_HOME:-$HOME/.memgrep}"
RUN_DIR="$MEMGREP_HOME/tunnel"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli.js"

stop_pid_file() {
  local label="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    echo "$label: not running (no pid file)"
    return
  fi
  local pid
  pid="$(tr -d '[:space:]' <"$pid_file")"
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "$label: empty pid file removed"
    return
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.3
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "$label: stopped (pid $pid)"
  else
    echo "$label: not running (stale pid $pid)"
  fi
  rm -f "$pid_file"
}

echo "Stopping ngrok / standalone serve / foreground bots…"
stop_pid_file "ngrok" "$RUN_DIR/ngrok.pid"
stop_pid_file "serve" "$RUN_DIR/serve.pid"
stop_pid_file "caffeinate" "$RUN_DIR/caffeinate.pid"
stop_pid_file "telegram" "$RUN_DIR/telegram.pid"
stop_pid_file "jobs" "$RUN_DIR/jobs.pid"

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "Stopping macOS LaunchAgents…"
  uid="$(id -u)"
  for label in com.memgrep.ngrok com.memgrep.caffeinate com.memgrep.telegram com.memgrep.jobs; do
    launchctl bootout "gui/${uid}/${label}" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/${label}.plist"
  done
  if [[ -f "$CLI" ]]; then
    node "$CLI" telegram uninstall 2>/dev/null || true
    node "$CLI" jobs uninstall 2>/dev/null || true
  fi
fi

echo "All stopped. Start again with: npm start"
