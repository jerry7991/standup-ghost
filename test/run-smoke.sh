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
# Redirect both logs into TMP — the real ones are production run history.
export STANDUP_GHOST_LOG="$TMP/standup-ghost.log"
export STANDUP_GHOST_WATCHDOG_LOG="$TMP/watchdog.log"
export HOME_LOG="$STANDUP_GHOST_LOG"
export WD_LOG="$STANDUP_GHOST_WATCHDOG_LOG"

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
: > "$WD_LOG" 2>/dev/null || true
zsh "$TMP/share/runtime/watchdog.sh"
grep -q "NOTIFY: No standup activity" "$WD_LOG"; check $? "watchdog alarms on stale receipts"

# 4b) watchdog catch-up: a scheduled day with no receipt must rerun the daily job
cat > "$STANDUP_GHOST_CONFIG_DIR/config.json" <<EOF
{ "sources": {}, "sinks": {}, "flavors": {},
  "schedule": { "days": [0,1,2,3,4,5,6], "hour": 11, "minute": 22 },
  "behavior": { "alarm_threshold_days": 2, "pending_max_age_days": 7, "notify_on_post": false } }
EOF
rm -rf "$STANDUP_GHOST_STATE_DIR/receipts"
: > "$WD_LOG"; : > "$HOME_LOG"
zsh "$TMP/share/runtime/watchdog.sh"
grep -q "kickstart: no receipt" "$WD_LOG"; check $? "watchdog kickstarts a missed run on a scheduled day"
grep -q "run start" "$HOME_LOG"; check $? "kickstart actually invoked run.sh"

# 4c) ...but NOT on a non-scheduled day
cat > "$STANDUP_GHOST_CONFIG_DIR/config.json" <<EOF
{ "sources": {}, "sinks": {}, "flavors": {},
  "schedule": { "days": [], "hour": 11, "minute": 22 },
  "behavior": { "alarm_threshold_days": 2, "pending_max_age_days": 7, "notify_on_post": false } }
EOF
: > "$WD_LOG"; : > "$HOME_LOG"
zsh "$TMP/share/runtime/watchdog.sh"
grep -q "kickstart" "$WD_LOG" && { echo "❌ kickstarted on a non-scheduled day"; FAIL=1; } || echo "✅ no kickstart on a non-scheduled day"

# 4d) and NOT when a receipt already exists (must never double-post)
cat > "$STANDUP_GHOST_CONFIG_DIR/config.json" <<EOF
{ "sources": {}, "sinks": {}, "flavors": {},
  "schedule": { "days": [0,1,2,3,4,5,6], "hour": 11, "minute": 22 },
  "behavior": { "alarm_threshold_days": 2, "pending_max_age_days": 7, "notify_on_post": false } }
EOF
node "$TMP/share/runtime/lib/statecli.js" skipped-receipt already-ran >/dev/null
: > "$WD_LOG"; : > "$HOME_LOG"
zsh "$TMP/share/runtime/watchdog.sh"
grep -q "kickstart" "$WD_LOG" && { echo "❌ kickstarted despite today's receipt"; FAIL=1; } || echo "✅ no kickstart when today already has a receipt"

# 5) receipts with no `at` must still yield a finite age (the NaN that muted the watchdog)
mkdir -p "$STANDUP_GHOST_STATE_DIR/receipts"
cat > "$STANDUP_GHOST_STATE_DIR/receipts/2026-01-02__file.json" <<< '{"date":"2026-01-02","sink":"file","provenance":"scheduled"}'
AGE="$(node "$TMP/share/runtime/lib/statecli.js" status | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).last_receipt_age_days")"
[[ "$AGE" != "null" && "$AGE" != "NaN" ]]; check $? "legacy receipt without 'at' yields finite age (got $AGE)"
rm -rf "$STANDUP_GHOST_STATE_DIR/receipts"

# 6) a hung LLM stage is killed at the wall-clock cap instead of blocking forever
cat > "$TMP/bin/claude-hang" <<'EOF'
#!/bin/zsh
[[ "$1" == "mcp" ]] && exit 0
sleep 600
EOF
chmod +x "$TMP/bin/claude-hang"
: > "$HOME_LOG"
T0=$SECONDS
STANDUP_GHOST_CLAUDE_BIN="$TMP/bin/claude-hang" STANDUP_GHOST_STAGE_TIMEOUT=5 \
  zsh "$TMP/share/runtime/run.sh"
ELAPSED=$((SECONDS - T0))
grep -q "LLM stage killed at 5s wall clock" "$HOME_LOG"; check $? "hung LLM stage killed at the cap"
[[ $ELAPSED -lt 60 ]]; check $? "hung run returns promptly (${ELAPSED}s, not blocked)"
grep -q "NOTIFY: Standup timed out after" "$HOME_LOG"; check $? "timeout raises a timeout-specific alarm"
[[ ! -d "$STANDUP_GHOST_STATE_DIR/.run-lock" ]]; check $? "lock released after a timeout kill"
grep -q "run end" "$HOME_LOG"; check $? "run end still written after a timeout"

rm -rf "$TMP"
[[ $FAIL -eq 0 ]] && echo "SMOKE PASS" || echo "SMOKE FAIL"
exit $FAIL
