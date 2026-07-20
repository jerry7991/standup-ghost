---
name: recap
description: Search and summarize your own work history from the standup archive — "what did I do between two dates", a TLDR of the week/month/quarter/half (appraisal season fuel), or a keyword search across everything you've shipped. Use for "recap my month", "what did I do in March", "find when I worked on X", "/standup-ghost:recap".
---

# Standup Ghost — recap & search

Reads the local archive (`~/.local/state/standup-ghost/out/standup-<YYYY-MM-DD>.md` — one file per posted day) plus receipts. No network needed for archive-covered ranges; nothing new is stored.

## Verbs (ALL on-demand — this skill never runs on a schedule and never auto-posts)
- `recap week|month|quarter|half|year` — TLDR of the period ending today.
- `recap <YYYY-MM-DD>..<YYYY-MM-DD>` — explicit range.
- `find <query> [range]` — where/when a topic appears ("find payment-retry", "find PROJ-42 in Q1").
- `recap team [range]` — READ-ONLY digest of the shared canvas: read everyone's dated sections in range (requires the slack-canvas sink configured), group by person/handle, summarize per person + cross-team themes. Uses only what teammates already posted publicly; output stays in chat unless the user explicitly asks to deliver it somewhere.
- `recap sprint` — current-sprint slice: filter the range to the active sprint (ask Jira `sprint in openSprints() AND assignee = currentUser()` for the sprint window/name) and recap just that.

## Recap — how to compose
1. Select archive files in range by filename date (they're self-dated; no index needed).
2. Aggregate by initiative bucket across days: what LANDED (Yesterday outcomes), sustained threads, one-off wins. Dedupe the daily repetition — a ticket that appeared 9 days collapses to one line with its arc ("PROJ-42: started 03-02, landed 03-18").
3. Counts from links: distinct tickets touched/closed, PRs merged, review load, meetings-without-tickets.
4. Output shape (terse, tables-first):
   - One-paragraph TLDR.
   - Per-bucket table: bucket / arc / key links.
   - Numbers row: tickets, PRs, span, days posted vs working days.
5. Deliver: chat by default; on request, the file sink (`out/recap-<range>.md`) or self-DM. Never post a recap to team sinks without explicit confirmation.

## Gaps are honest, and backfillable
The archive only covers days the file sink was enabled. For gaps in the requested range:
- Say exactly which spans are missing — never silently pretend coverage.
- Offer **backfill mode**: run the source cards (Jira `updated >= range`, GitHub `updated:>=`, sessions if within retention) over the missing span and merge, clearly marked "reconstructed from sources, not from posted standups".

## Find — search rules
Case-insensitive match over archive content; report as a dated table: date / matching line / link. For ticket keys, also check receipts (a delivery on a date proves the standup mentioned it even if phrasing differs).
