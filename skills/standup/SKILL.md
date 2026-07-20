---
name: standup
description: Compose and deliver today's standup from what you actually did — Jira, GitHub, Claude sessions, Calendar — via the enabled sink cards. Verbs — (default) full run; "dry-run" composes to the file sink only; "post" approves a held review-draft. Used by the scheduled headless runner and interactively ("post my standup", "/standup-ghost:standup").
---

# Standup Ghost — the daily run

Config: `~/.config/standup-ghost/config.json`. Cards: `cards/` next to this plugin's root (the RUNTIME copy when invoked by the scheduler). State: `~/.local/state/standup-ghost/`. Tool permissioning comes exclusively from the generated `--allowedTools` (headless) or interactive approval — this skill declares no tool list.

## Intent (do not silently expand)
Collect → merge → compose (Yesterday/Today, bucketized) → deliver via enabled sink cards → receipts. It does NOT edit tickets, post anywhere unconfigured, summarize other people, or fabricate activity.

## Step 0 — Guards
1. Read config; missing ⇒ STOP: "run /standup-ghost:setup first".
2. `state-corrupt` marker set ⇒ compose but HOLD all delivery (`held` pending) and say so — doctor must clear it (receipts may be incomplete; auto-delivery could double-post).
3. `paused` marker ⇒ write `skipped` receipt (reason: paused), stop.

## Step 1 — Working-day gate + window (gcal card)
Follow `cards/sources/gcal.md` absence detection. If today is non-working and `absence.auto_skip` ⇒ `skipped` receipt (reason: the absence type) and STOP — no pending, no alarm. Otherwise compute the window:
```bash
node <runtime>/lib/workdays.js '{"schedule_days":..., "absence_dates":[...], "min_hours":<format.lookback_hours>, "max_lookback_days":<absence.max_lookback_days>}'
```
`lookback_hours` now spans back to the last day you actually worked (weekend, leave, sick days, holidays all bridged). **Heading date/day comes from running `date '+%a %Y-%m-%d'` — never inferred.**

## Step 2 — Collect (every enabled source card, degrade-per-lane)
Execute each `cards/sources/*.md` fetch recipe with the computed window. A dark lane = visible flag + fewer bullets; never a dead run, never invented content. Load deferred MCP tools via ToolSearch as needed.

## Step 3 — Compose (format v2 — terse, bucketized)
1. Merge by ticket key (branch `PROJ-42-*` + PR title + ticket = ONE item).
2. Two blocks only — **Yesterday** (outcomes) / **Today** (intent). One line per initiative bucket (`format.buckets_hint` + derived), max `format.max_bullets_per_block` bucket lines; meetings without a ticket in ONE bracketed `(Calls: …)` line per block. Every ticket/PR is a link. No Blockers block, no tables, no sub-bullets.
   **Reviews are ACTIVITY, not a queue:** report only reviews the user actually gave (`Reviews: repo#1 (approved), repo#2 (comments)`) and feedback they addressed on their own PRs (`addressed review feedback on repo#3` — folds into that PR's bucket line). NEVER report "N PRs awaiting my review" — pending queues aren't standup content.
3. Heading: `format.heading` with `{DOW} {DATE}` from `date`, `{handle}` from config.
4. **Min-content gate:** fewer than `behavior.min_content_bullets` real bullets ⇒ write `held` pending (never auto-posts) + note; STOP.
5. **Review mode** (`behavior.review_mode`): deliver the draft to your own Slack DM (slack-channel card transport), write `held`, STOP. Approval = `/standup-ghost:standup post`.

## Step 4 — Deliver (every enabled sink card)
1. **Flush first:** post `failed` pending entries per their card's backlog rules (channel: collapsed single message). `held` entries NEVER flush.
2. Deliver today's standup per each `cards/sinks/*.md` recipe (canvas: section semantics + read-back; channel: `ts` receipt; file: archive).
3. Per-sink outcome: success ⇒ receipt (`provenance`: `scheduled` when invoked by the runner, `manual`/`kickstart` otherwise); failure ⇒ `failed` pending for THAT sink only.

## Verbs
- **dry-run**: Steps 1–3, deliver ONLY via the file card, print the path + what WOULD go where (resolved destination names). No receipts beyond file.
- **post**: take today's `held` draft, run Step 4 with it (this is review-mode approval).

## Output contract
End with: ✅/⚠️ status, lanes ran/dark, bullet counts, per-sink outcome + links (or pending/held reason). Never fabricate.
