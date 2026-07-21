---
kind: sink
name: slack-channel
connector: slack
reviewed: true
flavors: [claudeai, token]
tools-claudeai: [mcp__claude_ai_Slack__slack_send_message]
cli: [node]
requires-config: sinks.slack-channel.channel_id
---

# Sink: Slack channel message (team updates channel)

**Transport** — shares `flavors.slack` with the canvas sink: `claudeai` (interactive connector, dark in headless) or `token` (Slack Web API via `slack_bot_token`, proven headless — scope `chat:write`, bot must be in the channel). Pick `token` for scheduled delivery.

## Probe
- `claudeai`: tool available + `sinks.slack-channel.channel_id` set.
- `token`: `slack_bot_token` in secrets + `channel_id` set.
Post failures ⇒ `failed` pending.

## Deliver — `token` flavor (headless)
```bash
node <runtime>/lib/slack.js channel-post --channel <sinks.slack-channel.channel_id> --body-file <tmpfile> [--ts <receipt.ts>]
```
Fresh post when no `ts`; a same-day re-run passes the receipt's `ts` → `chat.update` (parity with the canvas replace, never a duplicate). Prints `{ts}` for the receipt. Non-zero exit ⇒ `failed` pending.

## Deliver — `claudeai` flavor
Post the composed standup as one message to the configured channel, prefixed with the dated heading line.

## Idempotency (streams can't be edited by re-insert — receipts carry the `ts`)
- On success, the receipt stores the message `ts`.
- Same-day re-run: consult the receipt — **update the existing message via its `ts`** (default; keeps parity with the canvas sink's replace semantics). If update isn't possible, skip and note it — NEVER post a duplicate.
- **Backlog flush** (multi-day `failed` pending): collapse ALL pending days into ONE message with per-day headers, each stamped with its compose date — never a burst of separate posts.

## Review-mode transport (R17a)
When `behavior.review_mode` is on, this card's tool doubles as the draft channel: send the draft to the USER's own DM (self-DM), mark the day `held`. Approval = the user runs `/standup-ghost:standup post`. Unapproved by the next run ⇒ superseded.

## Receipt
`{date, sink: "slack-channel", provenance, data: {ts}}`.
