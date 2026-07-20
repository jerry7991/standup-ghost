---
name: setup
description: Interactive onboarding for Standup Ghost — collects your config, resolves connector flavors, dry-runs, makes the first real post, installs the launchd schedule (one paste), and verifies liveness end-to-end. Resumable; use for "set up standup ghost" or "/standup-ghost:setup".
---

# Standup Ghost — setup wizard

State machine in `~/.local/state/standup-ghost/setup-state.json`: `configured → verified-post → scheduled → live`. Re-running RESUMES from the recorded state. Setup is complete ONLY at `live`.

## 1 — Config (state: configured) — DISCOVER FIRST, ask only what can't be discovered
The connected tools identify their own authenticated user — the user confirms values, they don't type IDs:

| Field | Discovery recipe |
|---|---|
| `identity.email`, display name | seed from `git config user.email` / `user.name`; authoritative from Atlassian `atlassianUserInfo` |
| Jira site / cloudId | `getAccessibleAtlassianResources` (JQLs use `currentUser()` — no Jira account ID is ever stored) |
| `identity.github_login` | `cli` flavor: `gh api user --jq .login`; `mcp` flavor: queries can use `author:@me` (login stored for display only) |
| `identity.slack_user_id` | `slack_search_users` with the discovered email → confirm by display name (needed for review-mode self-DM) |
| `identity.handle` | default = Slack display name (it's the canvas idempotency key — offer override) |
| `identity.timezone` | system `date`; confirm |
| canvas / channel IDs | ask for the NAME ("#team-updates", "Stand-up canvas"), resolve via `slack_search_channels` / `slack_search_public`, echo the resolved name, write the ID |

Then ask only the genuinely personal choices: schedule, which sources/sinks to enable, absence patterns + optional company-holiday calendar, behavior knobs (review_mode, notify_on_post, min-content). Write `~/.config/standup-ghost/config.json` from `config.example.json` and echo the finished config back as a table (names, not raw IDs).

## 2 — Doctor pass + flavor resolution
Run the doctor (below) inline. Critically: PROBE which connector flavor exists per card (`tools-local` vs `tools-claudeai` candidates) and write the winner into `config.flavors.<connector>`. Zero live sources or zero live sinks ⇒ STOP with remediation; do not schedule.

## 3 — Dry-run + destination confirmation
`/standup-ghost:standup dry-run` with real data. Show the composed standup AND each resolved destination by NAME (channel name, canvas title — not raw IDs). User confirms. Rejection ⇒ back to step 1 (state stays `configured`; doctor reports "setup incomplete").

## 4 — First real post (state: verified-post)
Run the standup for real once, interactively. Confirm links.

## 5 — Schedule (state: scheduled)
1. Sync the runtime bundle: copy `{run.sh, watchdog.sh, lib/, session_scan.js, cards/}` + a `VERSION` stamp (plugin.json version) to `~/.local/share/standup-ghost/runtime/`, `chmod +x` the scripts, and write `~/.local/share/standup-ghost/plugin-root` (the plugin's install path). TCC rule: NEVER place the runtime under `~/Desktop` or `~/Documents`.
2. Render both plists (`node lib/plist.js main|watchdog`) into `~/.local/share/standup-ghost/`.
3. Hand the user ONE paste (the harness cannot touch `~/Library/LaunchAgents` or run `launchctl`):
```
cp ~/.local/share/standup-ghost/com.standup-ghost.*.plist ~/Library/LaunchAgents/ ; launchctl bootout gui/$(id -u)/com.standup-ghost.daily 2>/dev/null ; launchctl bootout gui/$(id -u)/com.standup-ghost.watchdog 2>/dev/null ; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.standup-ghost.daily.plist ; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.standup-ghost.watchdog.plist ; launchctl list | grep standup-ghost
```
4. Verify loaded: attempt `launchctl print gui/$(id -u)/com.standup-ghost.daily`; if the environment denies launchctl, ask the user to paste that command's output and parse it. Not loaded ⇒ stay at `scheduled`.
5. Kickstart verification: user pastes `launchctl kickstart -k gui/$(id -u)/com.standup-ghost.daily`; confirm a receipt appears AND fire a TEST notification through the same path — the user must confirm they SAW it (macOS can silently suppress osascript notifications; if unseen, point at System Settings → Notifications → Script Editor).

## 6 — Live (state: live)
`live` is set only after a **`scheduled`-provenance receipt** exists (the first genuinely calendar-fired run) — kickstart proves the run path, not the schedule. Until then doctor reports "scheduled, awaiting first calendar fire (next: <computed>)".

## Uninstall verb
Pending entries exist ⇒ WARN + offer export (file sink) or post first. Then hand the bootout paste (both jobs), remove `~/.local/share/standup-ghost` and (on request) config + state.
