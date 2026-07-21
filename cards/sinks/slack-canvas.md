---
kind: sink
name: slack-canvas
connector: slack
reviewed: true
flavors: [claudeai, token]
tools-claudeai: [mcp__claude_ai_Slack__slack_read_canvas, mcp__claude_ai_Slack__slack_update_canvas]
cli: [node]
requires-config: sinks.slack-canvas.canvas_id
---

# Sink: Slack canvas (shared team stand-up doc)

**Transport** — set `flavors.slack` in config (setup asks when both are available):
- `claudeai` — the claude.ai Slack connector (`slack_read_canvas` / `slack_update_canvas`). Works interactively; **absent in headless `claude -p`** (launchd/cron) — the scheduled run cannot authenticate it, so the canvas goes dark on a schedule.
- `token` — the Slack Web API via a bot token. **Proven headless** (like github's `cli` flavor). Needs `slack_bot_token` in `~/.config/standup-ghost/secrets.json` (scopes `canvases:read`,`canvases:write`; bot must be a member of the canvas). This is the transport to pick if you want the *scheduled* post to actually land.

## Probe
- `claudeai`: `slack_read_canvas(sinks.slack-canvas.canvas_id)` — auth error / not found ⇒ sink dark ⇒ composed standup goes to `failed` pending, wrapper alarms.
- `token`: `slack_bot_token` present in secrets + `node lib/slack.js` reachable. A dry probe is `canvases.sections.lookup` on the canvas — `not_authed`/`missing_scope`/`canvas_not_found` ⇒ sink dark (same degrade path).

## Deliver — `token` flavor (headless)
One command; the idempotency + read-back live in the tested helper (`runtime/lib/slack.js`). Write the composed standup (heading + body, GitHub-flavored markdown) to a temp file, then:
```bash
node <runtime>/lib/slack.js canvas-upsert \
  --canvas <sinks.slack-canvas.canvas_id> \
  --match "<DATE> — <identity.handle>" \
  --body-file <tmpfile>
```
`--match` is the UNIQUE part of your heading (date + handle) — the per-person idempotency key. The helper: looks up your section → `replace` it in place if present, else `insert_before` the topmost header (newest-on-top) / `insert_at_start` on an empty canvas → **reads back** (your heading must resolve to exactly one section, retry ≤2). Non-zero exit ⇒ write a `failed` pending for `slack-canvas` (never a receipt). Success ⇒ receipt below. NEVER touch other people's sections (the helper only ever targets your own heading match).

## Deliver — `claudeai` flavor — section semantics (verified 2026-07-16; canvas API HAS drifted before, trust nothing without read-back)
- ⚠️ `edit_type=replace` **without** a `section_id` WIPES the whole canvas. Never.
- ⚠️ Parameterless legacy `action=prepend` is REJECTED by current Slack.
- ⚠️ `prepend` targeting a non-heading body element REPLACES that element. Only ever target headings.
- Insert newest-on-top: ONE `sections` op, `edit_type=prepend`, `section_id` = the **topmost day heading** (`## …`) from `section_id_mapping`. Empty canvas (no day headings): `append` targeting the title section.
- End content with a `---` divider.

## Idempotency + multi-writer (shared canvas, several people's ghosts)
- Idempotency key = the heading: date + `identity.handle`. If today's heading with OUR handle exists ⇒ `replace` that section (and its stale body elements), never insert a duplicate.
- Other people's sections are NEVER touched; anchoring is always relative to the topmost day heading regardless of whose it is.
- **Post-write read-back is mandatory:** re-read the canvas; our date+handle heading must exist exactly once. Clobbered/missing (concurrent writer race) ⇒ re-read + retry (max 2), then write a `failed` pending entry — the alarm carries the count.

## Receipt
`{date, sink: "slack-canvas", provenance, data: {section_heading}}` after verified read-back only.
