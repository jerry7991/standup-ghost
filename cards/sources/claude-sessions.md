---
kind: source
name: claude-sessions
reviewed: true
cli: [node]
---

# Source: Claude Code sessions (what you actually worked on)

Reads your LOCAL `~/.claude/projects` session history — this lane knows about work that never touched Jira or GitHub.

## Privacy contract (hard rule)
This card's output is **bounded summaries only**: project name, git branch, session summary titles, a ≤250-char first-ask excerpt, turn counts. Raw transcript content (tool output, file contents, pasted secrets) NEVER reaches the compose stage or any sink. `runtime/session_scan.js` enforces this structurally — it emits only those fields.

## Probe
`node --version` and `~/.claude/projects` exists. Missing ⇒ lane dark (normal for people who don't use Claude Code locally).

## Fetch
```bash
node <runtime>/session_scan.js --hours <lookback_hours> \
  --max <sources.claude-sessions.max_sessions> --min-turns <sources.claude-sessions.min_user_turns>
```

## Output contract
JSON array: `{project, mtime, sizeKB, branch, userTurns, summaries[], firstAsk}` — trivial sessions dropped; branch names carry ticket keys for cross-source merge.
