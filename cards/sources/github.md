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
gh search prs --author=<identity.github_login> --owner=<identity.github_org> \
  --updated=">=$SINCE" --sort=updated --order=desc --limit 20 \
  --json title,url,state,isDraft,repository,updatedAt
gh search prs --owner=<identity.github_org> --state=open --limit 10 \
  --json title,url,repository -- "user-review-requested:<identity.github_login>"
```

## Fetch — `mcp` flavor
Two `search_issues` calls (compute `SINCE` with `date` as above):
1. `is:pr author:<identity.github_login> org:<identity.github_org> updated:>=SINCE` sorted by updated desc.
2. `is:pr is:open org:<identity.github_org> user-review-requested:<identity.github_login>`.

## Output contract (identical for both flavors)
Authored/merged PRs: `{title, url, state, repo, updatedAt}` — ticket keys parsed from titles/branches merge with the Jira lane. The review-requested list renders as ONE "Reviews: N PRs" line under Today (top 1–2 links), never one bullet per PR.
