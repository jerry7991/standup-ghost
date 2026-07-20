#!/bin/zsh
# Standup Ghost — scheduled headless runner. Runs under launchd as plain zsh
# (managed-policy tool denies bind the Claude harness, not this process).
# ALARM HYGIENE: notification bodies are built ONLY from counts/dates — never
# interpolate ticket/event text (osascript injection surface).
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

RUNTIME_DIR="${STANDUP_GHOST_RUNTIME_DIR:-$HOME/.local/share/standup-ghost/runtime}"
STATE_DIR="${STANDUP_GHOST_STATE_DIR:-$HOME/.local/state/standup-ghost}"
SHARE_DIR="$(dirname "$RUNTIME_DIR")"
LOG="$HOME/Library/Logs/standup-ghost.log"
CLAUDE_BIN="${STANDUP_GHOST_CLAUDE_BIN:-claude}"
MAX_TURNS="${STANDUP_GHOST_MAX_TURNS:-60}"
LOCK="$STATE_DIR/.run-lock"

notify() { # $1 = static text; counts/dates only
  [[ "${STANDUP_GHOST_NO_NOTIFY:-0}" == "1" ]] && { echo "NOTIFY: $1"; return; }
  osascript -e "display notification \"$1\" with title \"Standup Ghost\"" 2>/dev/null || true
}

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') run start ====="
  cd "$RUNTIME_DIR" || { echo "FATAL: runtime missing at $RUNTIME_DIR"; notify "Runtime missing — run /standup-ghost:doctor"; exit 1; }

  # --- run lock (serialize wake-fired + manual overlap) ---
  mkdir -p "$STATE_DIR" 2>/dev/null
  if ! mkdir "$LOCK" 2>/dev/null; then
    if [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then
      rm -rf "$LOCK"; mkdir "$LOCK" || exit 0
    else
      echo "concurrent run — skipping"; node lib/statecli.js skipped-receipt concurrent; exit 0
    fi
  fi
  trap 'rm -rf "$LOCK"' EXIT

  # --- pause flag ---
  if [[ -f "$STATE_DIR/marker-paused.json" ]]; then
    echo "paused — skipping"; node lib/statecli.js skipped-receipt paused; exit 0
  fi

  # --- runtime-vs-plugin version drift (checked EVERY run, not just doctor) ---
  PLUGIN_ROOT="$(cat "$SHARE_DIR/plugin-root" 2>/dev/null || true)"
  if [[ -n "$PLUGIN_ROOT" && -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" && -f "$RUNTIME_DIR/VERSION" ]]; then
    PLUGIN_VER="$(node -p "require('$PLUGIN_ROOT/.claude-plugin/plugin.json').version" 2>/dev/null || true)"
    RUNTIME_VER="$(cat "$RUNTIME_DIR/VERSION")"
    if [[ -n "$PLUGIN_VER" && "$PLUGIN_VER" != "$RUNTIME_VER" ]]; then
      echo "version drift: runtime=$RUNTIME_VER plugin=$PLUGIN_VER"
      notify "Update available: runtime $RUNTIME_VER vs plugin $PLUGIN_VER — run /standup-ghost:doctor to resync"
    fi
  fi

  # --- the run (LLM stage; allowlist generated from enabled cards) ---
  ALLOW="$(node lib/allowlist.js)" || { notify "Allowlist composition failed — run /standup-ghost:doctor"; exit 1; }
  "$CLAUDE_BIN" -p "/standup-ghost:standup — scheduled unattended run. Follow the skill end-to-end: working-day gate first, then collect, compose, deliver. Never wait for user input." \
    --allowedTools "$ALLOW" --max-turns "$MAX_TURNS" 2>&1

  # --- post-run status → notify / alarm (counts + dates only) ---
  STATUS="$(node lib/statecli.js status)"
  echo "status: $STATUS"
  TODAY_OK="$(node -p "(${STATUS}).today_receipt")"
  FAILED_DAYS="$(node -p "(${STATUS}).pending_failed_days")"
  CORRUPT="$(node -p "(${STATUS}).state_corrupt")"
  THRESHOLD="$(node -p "(${STATUS}).alarm_threshold_days")"
  NOTIFY_ON_POST="$(node -p "(${STATUS}).notify_on_post")"

  if [[ "$CORRUPT" == "true" ]]; then
    notify "State corrupted — delivery held. Run /standup-ghost:doctor"
  elif [[ "$TODAY_OK" != "true" ]]; then
    notify "Today's standup did NOT post — run /standup-ghost:doctor"
  elif (( FAILED_DAYS >= THRESHOLD )); then
    notify "$FAILED_DAYS day(s) of standups stuck in pending — run /standup-ghost:doctor"
  elif [[ "$NOTIFY_ON_POST" == "true" ]]; then
    notify "Standup posted for $(date '+%Y-%m-%d')"
  fi
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') run end ====="
} >> "$LOG" 2>&1
