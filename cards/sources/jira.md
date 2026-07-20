---
kind: source
name: jira
connector: atlassian
reviewed: true
tools-local: [mcp__atlassian__searchJiraIssuesUsingJql]
tools-claudeai: [mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql]
cli: [jq]
requires-config: sources.jira.site
---

# Source: Jira (your tickets)

## Probe
Run the resolved search tool with `jql = "assignee = currentUser()"`, `maxResults = 1`, `cloudId = <sources.jira.site>`. Auth error or missing tool ⇒ lane dark (degrade, flag). Setup resolves which connector flavor exists (`local` vs `claudeai`) and records it in `flavors.atlassian`.

## Fetch
Two queries, `fields = sources.jira.fields`, `maxResults = 50`, substituting `{lookback_hours}` from the working-day math:
1. `sources.jira.jql_recent` — what moved in the window.
2. `sources.jira.jql_in_progress` — what's on the plate.

**Overflow is NORMAL:** results exceed context and auto-save to a file. Do not re-query smaller — extract compact rows:
```bash
jq -r '.issues.nodes[] | [.key, .fields.status.name, (.fields.priority.name // "-"),
  (.fields.issuetype.name // "-"), (.fields.updated // "" | .[0:16]),
  (.fields.summary | .[0:90])] | @tsv' <saved-file>
```

**Zombie filter:** in-progress issues not updated within `sources.jira.in_progress_max_age_days` never reach the Today block (long-lived boards accumulate years-old in-progress tickets).

## Optional: sprint context (OFF by default — on-demand only)
When `sources.jira.include_sprint` is true OR the user explicitly asks, add the `sprint` field to the query and prefix bucket lines with the active sprint name. Never fetched otherwise — the daily standup stays lean by default.

## Output contract
Compact rows: `{key, status, priority, type, updated, summary}` (+ `sprint` when enabled) — keys become markdown links via `sources.jira.browse_base + key`. The ticket key is the cross-source merge key.
