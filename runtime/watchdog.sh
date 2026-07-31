#!/bin/zsh
# Standup Ghost watchdog — the OUT-OF-BAND liveness detector. Independent
# launchd job whose only work is: "has anything produced a receipt lately?"
# It catches the failure the main job cannot report on: the main job not
# running at all (unloaded after an OS update, broken runtime path, etc).
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
RUNTIME_DIR="${STANDUP_GHOST_RUNTIME_DIR:-$HOME/.local/share/standup-ghost/runtime}"
CONFIG_DIR="${STANDUP_GHOST_CONFIG_DIR:-$HOME/.config/standup-ghost}"
LOG="${STANDUP_GHOST_WATCHDOG_LOG:-$HOME/Library/Logs/standup-ghost.watchdog.launchd.log}"

notify() {
  [[ "${STANDUP_GHOST_NO_NOTIFY:-0}" == "1" ]] && { echo "NOTIFY: $1"; return; }
  osascript -e "display notification \"$1\" with title \"Standup Ghost watchdog\"" 2>/dev/null || true
}

{
  cd "$RUNTIME_DIR" || { notify "Standup Ghost runtime missing — reinstall or run /standup-ghost:doctor"; exit 1; }
  STATUS="$(node lib/statecli.js status)" || exit 1
  AGE="$(node -p "(${STATUS}).last_receipt_age_days")"
  THRESHOLD="$(node -p "(${STATUS}).alarm_threshold_days")"
  PAUSED="$(node -p "(${STATUS}).paused")"
  TODAY_OK="$(node -p "(${STATUS}).today_receipt")"
  echo "$(date '+%F %T') age=$AGE threshold=$THRESHOLD paused=$PAUSED today_receipt=$TODAY_OK"

  # A scheduled day still receiptless by now means the daily run never landed.
  WORKDAY="$(node -p "try{const c=require('$CONFIG_DIR/config.json');((c.schedule||{}).days||[1,2,3,4,5]).includes(new Date().getDay())}catch(e){false}" 2>/dev/null || echo false)"
  if [[ "$PAUSED" != "true" && "$TODAY_OK" != "true" && "$WORKDAY" == "true" ]]; then
    echo "kickstart: no receipt for $(date '+%F') on a scheduled day — running the daily job"
    /bin/zsh "$RUNTIME_DIR/run.sh"
    STATUS="$(node lib/statecli.js status)" || exit 1
    echo "post-kickstart status: $STATUS"
    AGE="$(node -p "(${STATUS}).last_receipt_age_days")"
  fi

  if [[ "$PAUSED" != "true" ]] && node -p "(${STATUS}).last_receipt_age_days > (${STATUS}).alarm_threshold_days" | grep -q true; then
    notify "No standup activity for $AGE days — the daily job may not be running. Run /standup-ghost:doctor"
  fi
} >> "$LOG" 2>&1
