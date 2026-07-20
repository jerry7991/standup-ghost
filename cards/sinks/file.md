---
kind: sink
name: file
reviewed: true
cli: [node]
---

# Sink: local file (demo sink, dry-run output, extensibility proof)

Writes the composed standup to `~/.local/state/standup-ghost/out/standup-<date>.md`. Three jobs:
1. **Dry-run output** — `standup dry-run` composes and delivers ONLY here.
2. **Extensibility falsifier** — this card was written strictly against `CONTRACT.md` with zero core changes; a new sink (Notion, Linear, email…) is exactly this much work.
3. **Always-on local archive** when enabled — your standups survive any Slack outage.

## Probe
State dir writable (always true after setup).

## Deliver
Write (atomic rename) `out/standup-<date>.md` with the composed markdown. Same-day re-run overwrites — the file IS the idempotency mechanism.

## Receipt
`{date, sink: "file", provenance, data: {path}}`.
