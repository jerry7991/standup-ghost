---
kind: source
name: github
connector: github
reviewed: true
flavors: [cli, mcp]
tools-mcp: [mcp__github__search_issues]
cli: [gh, date]
requires-config: identity.github_login
---

# Source: GitHub (your PRs)

**Your choice of transport** — set `flavors.github` in config (setup asks when both are available):
- `cli` — the `gh` CLI. No MCP tools; cheap, proven headless. Needs `gh auth login`.
- `mcp` — the GitHub MCP server (`mcp__github__search_issues`). No local CLI needed.

## Probe
- `cli`: `gh auth status` — non-zero ⇒ lane dark (degrade, flag).
- `mcp`: `search_issues` with a 1-result query ⇒ auth error / missing tool ⇒ lane dark.

## Fetch — `cli` flavor
**Flag form is mandatory** — the positional `-- "org:… updated:…"` query form breaks on quoting:
```bash
SINCE=$(date -v-<lookback_hours>H +%Y-%m-%d)
# 1) PRs I authored that moved
gh search prs --author=<identity.github_login> --owner=<identity.github_org> \
  --updated=">=$SINCE" --sort=updated --order=desc --limit 20 \
  --json title,url,state,isDraft,repository,updatedAt
# 2) Reviews I ACTUALLY gave (approved / changes-requested / reviewed)
gh search prs --reviewed-by=<identity.github_login> --owner=<identity.github_org> \
  --updated=">=$SINCE" --limit 20 --json title,url,state,repository,updatedAt
# 3) PRs I commented on (comment-only participation isn't a "review" to GitHub)
gh search prs --commenter=<identity.github_login> --owner=<identity.github_org> \
  --updated=">=$SINCE" --limit 20 --json title,url,state,repository,updatedAt
# Union 2+3, MINUS my own authored PRs (those are lane 1). For each of MY open
# PRs from lane 1 (cap 5), check whether I addressed review feedback:
gh pr view <url> --json reviewDecision,reviews,commits
#   -> others' reviews/comments exist AND my commits landed after the earliest
#      of them => "addressed review feedback".
```

## Fetch — `mcp` flavor
Same three searches via `search_issues` (compute `SINCE` with `date`):
1. `is:pr author:<login> org:<org> updated:>=SINCE`
2. `is:pr reviewed-by:<login> org:<org> updated:>=SINCE`
3. `is:pr commenter:<login> org:<org> updated:>=SINCE`
Union 2+3 minus 1's results; feedback-addressed detection via the PR details tool on my open PRs (cap 5).

## Output contract (identical for both flavors)
- Authored/merged PRs: `{title, url, state, repo, updatedAt}` — ticket keys parsed from titles/branches merge with the Jira lane; PRs where I addressed feedback carry `feedback_addressed: true`.
- Reviews GIVEN: `{title, url, repo, my_action: approved|changes_requested|commented}` — this is YESTERDAY ACTIVITY ("Reviewed: X (approved), Y (comments)"), never a pending-queue count. PRs merely awaiting my review are NOT reported.
