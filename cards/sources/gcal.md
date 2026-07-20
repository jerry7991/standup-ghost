---
kind: source
name: gcal
reviewed: true
tools: [mcp__claude_ai_Google_Calendar__list_events]
---

# Source: Google Calendar (meetings + working-day detection)

Two jobs: (1) meetings for the `(Calls: …)` line, (2) **absence detection** for the working-day gate.

## Probe
`list_events` on the primary calendar with a 1-day window. Auth error ⇒ lane dark; the working-day gate then falls back to weekends + `skipped` receipts only.

## Fetch — meetings
`list_events` spanning `[last_working_day, end of today]` in `identity.timezone`. Keep only `eventType == DEFAULT`; DROP events where self `responseStatus == declined` and anything matching `sources.gcal.exclude` (substring, case-insensitive). Past events → attended (Yesterday); today's upcoming → Today. A meeting that maps to a ticket folds into that bucket's line; the rest go in ONE bracketed `(Calls: …)` line per block.

## Fetch — absence detection (config: `absence.*`)
For the run date and each day in the lookback window, a day is NON-WORKING when any of:
- an event with `eventType` in `absence.event_types` (Google's native OUT_OF_OFFICE) covers it;
- an ALL-DAY / full-window event whose title matches `absence.event_patterns` (case-insensitive substring — catches "sick leave", "on leave", "vacation", "holiday");
- any all-day event on a calendar in `absence.holiday_calendar_ids` (company-holiday calendars).

If TODAY is non-working and `absence.auto_skip` is true ⇒ write a `skipped` receipt (reason included) and END the run: no compose, no pending, no alarm. Otherwise pass the collected absence dates to the working-day math:
```bash
node <runtime>/lib/workdays.js '{"schedule_days":[1,2,3,4,5],"absence_dates":["YYYY-MM-DD",...],"min_hours":<format.lookback_hours>,"max_lookback_days":<absence.max_lookback_days>}'
```
→ `{lookback_hours, last_working_day}` drives every other source's window, so the first run after leave covers everything since the last day you actually worked.

## Output contract
`{meetings: {attended[], upcoming[]}, absence_dates[], today_is_working: bool, lookback_hours}`.
