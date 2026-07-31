#!/bin/zsh
# Standup Ghost — scheduled headless runner. Runs under launchd as plain zsh
# (managed-policy tool denies bind the Claude harness, not this process).
# ALARM HYGIENE: notification bodies are built ONLY from counts/dates — never
# interpolate ticket/event text (osascript injection surface).
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

RUNTIME_DIR="${STANDUP_GHOST_RUNTIME_DIR:-$HOME/.local/share/standup-ghost/runtime}"
STATE_DIR="${STANDUP_GHOST_STATE_DIR:-$HOME/.local/state/standup-ghost}"
CONFIG_DIR="${STANDUP_GHOST_CONFIG_DIR:-$HOME/.config/standup-ghost}"
SHARE_DIR="$(dirname "$RUNTIME_DIR")"
LOG="${STANDUP_GHOST_LOG:-$HOME/Library/Logs/standup-ghost.log}"
CLAUDE_BIN="${STANDUP_GHOST_CLAUDE_BIN:-claude}"
MAX_TURNS="${STANDUP_GHOST_MAX_TURNS:-60}"
# Wall-clock cap on the LLM stage: --max-turns bounds turns, not time.
STAGE_TIMEOUT="${STANDUP_GHOST_STAGE_TIMEOUT:-900}"
LOCK="$STATE_DIR/.run-lock"

# Cards ship inside the runtime bundle; make the allowlist generator find them
# regardless of its default-path logic (the install-layout bug that silently
# produced an MCP-less allowlist — every Slack/Jira/Calendar call then denied).
[[ -d "$RUNTIME_DIR/cards" ]] && export STANDUP_GHOST_CARDS_DIR="${STANDUP_GHOST_CARDS_DIR:-$RUNTIME_DIR/cards}"

# Optional phone push (config.notifications.ntfy_topic) so failures reach the
# user even away from the Mac — the alarm channel must NOT depend on a data
# connector (the thing that may be down). Empty ⇒ local osascript only.
NTFY_TOPIC="$(node -p "try{(require('$CONFIG_DIR/config.json').notifications||{}).ntfy_topic||''}catch(e){''}" 2>/dev/null || true)"

notify() { # $1 = static text; counts/dates only (never ticket/event text)
  [[ "${STANDUP_GHOST_NO_NOTIFY:-0}" == "1" ]] && { echo "NOTIFY: $1"; return; }
  osascript -e "display notification \"$1\" with title \"Standup Ghost\"" 2>/dev/null || true
  [[ -n "$NTFY_TOPIC" ]] && curl -fsS -m 10 -H "Title: Standup Ghost" -d "$1" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true
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

  # --- connector-liveness preflight (claude.ai connectors lapse to "Needs
  # authentication" and can't self-re-auth headless) — warn early which one
  # needs /mcp, so a dark lane isn't a silent surprise. Best-effort. ---
  LAPSED="$("$CLAUDE_BIN" mcp list 2>/dev/null | grep -i 'Needs authentication' | sed -E 's/:.*//; s/^ *//' | paste -sd, - || true)"
  if [[ -n "$LAPSED" ]]; then
    echo "connectors need re-auth: $LAPSED"
    notify "Connector needs re-auth (open Claude Code, run /mcp): $LAPSED"
  fi

  # --- the run (LLM stage; allowlist generated from enabled cards) ---
  ALLOW="$(node lib/allowlist.js)" || { notify "Allowlist composition failed — run /standup-ghost:doctor"; exit 1; }
  # Hard kill: a hung MCP call would block forever and starve the alarms below.
  "$CLAUDE_BIN" -p "/standup-ghost:standup — scheduled unattended run. Follow the skill end-to-end: working-day gate first, then collect, compose, deliver. Never wait for user input." \
    --allowedTools "$ALLOW" --max-turns "$MAX_TURNS" 2>&1 &
  STAGE_PID=$!
  ( sleep "$STAGE_TIMEOUT"; kill -TERM "$STAGE_PID" 2>/dev/null; sleep 15; kill -KILL "$STAGE_PID" 2>/dev/null ) &
  REAPER_PID=$!
  wait "$STAGE_PID"; STAGE_RC=$?
  kill "$REAPER_PID" 2>/dev/null; wait "$REAPER_PID" 2>/dev/null || true
  STAGE_TIMED_OUT=0
  if (( STAGE_RC >= 128 )); then
    STAGE_TIMED_OUT=1
    echo "LLM stage killed at ${STAGE_TIMEOUT}s wall clock (rc=$STAGE_RC) — suspect a hung MCP tool call"
  fi

  # --- post-run status → notify / alarm (counts + dates only) ---
  STATUS="$(node lib/statecli.js status)"
  echo "status: $STATUS"
  TODAY_OK="$(node -p "(${STATUS}).today_receipt")"
  FAILED_DAYS="$(node -p "(${STATUS}).pending_failed_days")"
  TODAY_FAILED="$(node -p "((${STATUS}).today_failed_sinks||[]).join(',')")"
  TODAY_FAILED_N="$(node -p "((${STATUS}).today_failed_sinks||[]).length")"
  CORRUPT="$(node -p "(${STATUS}).state_corrupt")"
  THRESHOLD="$(node -p "(${STATUS}).alarm_threshold_days")"
  NOTIFY_ON_POST="$(node -p "(${STATUS}).notify_on_post")"

  if [[ "$CORRUPT" == "true" ]]; then
    notify "State corrupted — delivery held. Run /standup-ghost:doctor"
  elif [[ "$TODAY_OK" != "true" ]]; then
    if (( STAGE_TIMED_OUT )); then
      notify "Standup timed out after $((STAGE_TIMEOUT / 60))m and did NOT post — run /standup-ghost:doctor"
    else
      notify "Today's standup did NOT post — run /standup-ghost:doctor"
    fi
  elif (( TODAY_FAILED_N > 0 )); then
    # A sink failed TODAY even though another succeeded — alarm same-day
    # instead of waiting for the multi-day backlog threshold (the old masking).
    notify "Today's standup failed to post to: $TODAY_FAILED — connector may need /mcp; then /standup-ghost:standup post"
  elif (( FAILED_DAYS >= THRESHOLD )); then
    notify "$FAILED_DAYS day(s) of standups stuck in pending — run /standup-ghost:doctor"
  elif [[ "$NOTIFY_ON_POST" == "true" ]]; then
    notify "Standup posted for $(date '+%Y-%m-%d')"
  fi
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') run end ====="
} >> "$LOG" 2>&1
