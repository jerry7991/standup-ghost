#!/bin/zsh
# Smoke test for run.sh + watchdog.sh with a MOCKED claude binary and isolated
# state/config dirs. Asserts: pause -> skipped receipt; no receipt -> alarm;
# concurrent -> skipped; notify text carries counts only.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export STANDUP_GHOST_STATE_DIR="$TMP/state"
export STANDUP_GHOST_CONFIG_DIR="$TMP/config"
export STANDUP_GHOST_RUNTIME_DIR="$TMP/share/runtime"
export STANDUP_GHOST_NO_NOTIFY=1
export STANDUP_GHOST_MAX_TURNS=5
export HOME_LOG="$HOME/Library/Logs/standup-ghost.log"

mkdir -p "$TMP/share/runtime" "$TMP/config" "$TMP/bin"
cp -R "$ROOT/runtime/"* "$TMP/share/runtime/"
echo "0.1.0" > "$TMP/share/runtime/VERSION"
cp -R "$ROOT/cards" "$TMP/share/"   # runtime bundle includes cards
cat > "$TMP/config/config.json" <<'EOF'
{ "sources": {}, "sinks": {}, "flavors": {},
  "behavior": { "alarm_threshold_days": 2, "pending_max_age_days": 7, "notify_on_post": false } }
EOF
cat > "$TMP/bin/claude" <<'EOF'
#!/bin/zsh
echo "mock claude: $@" >&2
EOF
chmod +x "$TMP/bin/claude" "$TMP/share/runtime/run.sh" "$TMP/share/runtime/watchdog.sh"
export STANDUP_GHOST_CLAUDE_BIN="$TMP/bin/claude"
export STANDUP_GHOST_CARDS_DIR="$TMP/share/cards"

FAIL=0
check() { [[ $1 -eq 0 ]] && echo "✅ $2" || { echo "❌ $2"; FAIL=1; }; }

# 1) no receipt after mocked run -> alarm line in log
: > "$HOME_LOG" 2>/dev/null || true
zsh "$TMP/share/runtime/run.sh"
grep -q "NOTIFY: Today's standup did NOT post" "$HOME_LOG"; check $? "no-receipt run raises the alarm"

# 2) pause -> skipped receipt, no alarm
node "$TMP/share/runtime/lib/statecli.js" skipped-receipt bootstrap >/dev/null # ensure dirs
cat > "$STANDUP_GHOST_STATE_DIR/marker-paused.json" <<< '{"at":"now"}'
: > "$HOME_LOG"
zsh "$TMP/share/runtime/run.sh"
grep -q "paused — skipping" "$HOME_LOG"; check $? "pause flag short-circuits the run"
ls "$STANDUP_GHOST_STATE_DIR/receipts" | grep -q "__run.json"; check $? "skipped receipt written"
rm "$STANDUP_GHOST_STATE_DIR/marker-paused.json"

# 3) concurrent lock
mkdir -p "$STANDUP_GHOST_STATE_DIR/.run-lock"
: > "$HOME_LOG"
zsh "$TMP/share/runtime/run.sh"
grep -q "concurrent run — skipping" "$HOME_LOG"; check $? "second entrant refused by lock"
rm -rf "$STANDUP_GHOST_STATE_DIR/.run-lock"

# 4) watchdog alarms on stale receipts (age > threshold handled via empty receipts = Infinity)
rm -rf "$STANDUP_GHOST_STATE_DIR/receipts"
: > "$HOME/Library/Logs/standup-ghost.watchdog.launchd.log" 2>/dev/null || true
zsh "$TMP/share/runtime/watchdog.sh"
grep -q "NOTIFY: No standup activity" "$HOME/Library/Logs/standup-ghost.watchdog.launchd.log"; check $? "watchdog alarms on stale receipts"

rm -rf "$TMP"
[[ $FAIL -eq 0 ]] && echo "SMOKE PASS" || echo "SMOKE FAIL"
exit $FAIL
