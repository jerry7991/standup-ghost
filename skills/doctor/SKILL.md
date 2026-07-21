---
name: doctor
description: Diagnose Standup Ghost end-to-end — per-card availability with exact remediation, connector flavor re-resolution, scheduler liveness, runtime version drift (resync with allowlist diff), receipt age, pending backlog, state recovery, pause/resume. Use for "standup ghost isn't posting", "check my standup setup", "/standup-ghost:doctor".
---

# Standup Ghost — doctor

Read-only except where it says so. Output: ONE table (component / status ✅⚠️❌ / remediation), then details only for non-green rows.

## Probes
1. **Config** parses; required keys per enabled card (`requires-config`) present. Setup state — anything below `live` ⇒ "setup incomplete at <state>: <what's next>".
2. **Sources & sinks** — run each enabled card's Probe section. For flavor-variant cards, RE-RESOLVE (probe both candidate tool sets via ToolSearch); if the resolved flavor changed, update `config.flavors` and say `🔧 healed`. Unreviewed cards in play ⇒ flag distinctly.
   - **Headless-connector trap (the #1 "it didn't post" cause):** any `claudeai`-flavor card (Slack sinks, gcal, atlassian) rides an interactive connector that is UNAVAILABLE in the scheduled `claude -p` run — it works when you test interactively but goes dark on a schedule. If `flavors.slack == "claudeai"` while a Slack sink is enabled AND a schedule is installed, flag ⚠️: the scheduled Slack post will fail to `failed` pending every run. Remediation: switch to the `token` flavor — add `slack_bot_token` to `~/.config/standup-ghost/secrets.json` (chmod 600; scopes `canvases:read`+`canvases:write` / `chat:write`; bot must be in the canvas/channel), set `flavors.slack="token"`, re-probe with `node lib/slack.js canvas-upsert` (dry via `canvases.sections.lookup`). Confirm `secrets.json` is 0600.
3. **Scheduler liveness** (the no-run failure class — nothing else can see it):
   - Jobs loaded: attempt `launchctl print gui/$(id -u)/com.standup-ghost.daily` (+ `.watchdog`); on managed deny, hand the user the command and parse pasted output.
   - Plists present in `~/Library/LaunchAgents/` and content matches a fresh render (schedule drift ⇒ offer regenerated paste).
   - **Last-receipt age** vs `behavior.alarm_threshold_days` (a `skipped` receipt counts as alive — pause/absence days are honest liveness).
4. **Runtime version drift**: `~/.local/share/standup-ghost/runtime/VERSION` vs the installed plugin's `plugin.json` (via `plugin-root` pointer; refresh the pointer if the plugin moved). On drift ⇒ offer resync: BEFORE copying, show the old-vs-new **generated allowlist diff**; if it WIDENS, require explicit confirmation (a widened tool grant must never ride a routine update silently). Resync = recopy bundle + VERSION.
5. **State health**: `state-corrupt` marker ⇒ show the quarantined file, offer rebuild (inspect quarantine, restore receipts it can prove, then clear the marker — delivery stays held until cleared). Pending backlog ⇒ per-day/per-sink table; ≥ threshold is loud.
6. **Pause**: `pause` sets the marker (runs write `skipped` receipts — no alarms while away); `resume` clears it.

## Contract
Every ❌/⚠️ row carries its exact fix (command to paste, config key to set, connector to authenticate). The table alone must be enough to self-serve.
