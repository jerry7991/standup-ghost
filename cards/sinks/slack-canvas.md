---
kind: sink
name: slack-canvas
connector: slack
reviewed: true
tools: [mcp__claude_ai_Slack__slack_read_canvas, mcp__claude_ai_Slack__slack_update_canvas]
requires-config: sinks.slack-canvas.canvas_id
---

# Sink: Slack canvas (shared team stand-up doc)

## Probe
`slack_read_canvas(sinks.slack-canvas.canvas_id)` — auth error / not found ⇒ sink dark ⇒ composed standup goes to `failed` pending, wrapper alarms.

## Deliver — section semantics (verified 2026-07-16; canvas API HAS drifted before, trust nothing without read-back)
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
