'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { compose, CORE_TOOLS, defaultCardsDir } = require('../runtime/lib/allowlist');

const write = (dir, name, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };
const fm = (lines) => `---\n${lines.join('\n')}\n---\n`;

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-allow-'));
  write(path.join(dir, 'sources'), 'jira.md', fm([
    'kind: source', 'name: jira', 'connector: atlassian', 'reviewed: true',
    'tools-local: [mcp__atlassian__searchJiraIssuesUsingJql]',
    'tools-claudeai: [mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql]',
  ]));
  write(path.join(dir, 'sinks'), 'slack-canvas.md', fm([
    'kind: sink', 'name: slack-canvas', 'reviewed: true',
    'tools: [mcp__claude_ai_Slack__slack_read_canvas, mcp__claude_ai_Slack__slack_update_canvas]',
  ]));
  return dir;
}
const config = (flavors) => ({
  sources: { jira: { enabled: true } },
  sinks: { 'slack-canvas': { enabled: true } },
  flavors, behavior: {},
});

test('composition = core + resolved card tools exactly, byte-stable', () => {
  const dir = fixtureDir();
  const a = compose(config({ atlassian: 'claudeai' }), dir);
  const expected = [...CORE_TOOLS,
    'mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql',
    'mcp__claude_ai_Slack__slack_read_canvas',
    'mcp__claude_ai_Slack__slack_update_canvas',
  ].sort().join(',');
  assert.strictEqual(a.allow, expected);
  assert.strictEqual(compose(config({ atlassian: 'claudeai' }), dir).allow, a.allow);
});

test('flavor switch swaps exactly the connector tools', () => {
  const dir = fixtureDir();
  const local = compose(config({ atlassian: 'local' }), dir).allow;
  assert.ok(local.includes('mcp__atlassian__searchJiraIssuesUsingJql'));
  assert.ok(!local.includes('mcp__claude_ai_Atlassian__'));
});

test('unresolved flavor degrades: card excluded, run proceeds with the rest', () => {
  const dir = fixtureDir();
  const r = compose(config({}), dir);
  assert.ok(!r.allow.includes('Atlassian'));
  assert.ok(r.allow.includes('mcp__claude_ai_Slack__slack_update_canvas'));
  assert.ok(r.excluded.some((e) => e.reason.includes('flavor unresolved')));
});

// Regression: the install layout (cards INSIDE runtime) must resolve, else the
// generated allowlist silently drops every MCP tool. Prefer <runtime>/cards.
test('defaultCardsDir prefers <runtime>/cards, falls back to <repo>/cards', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-layout-'));
  const libDir = path.join(root, 'runtime', 'lib');          // stands in for __dirname
  const runtimeCards = path.join(root, 'runtime', 'cards');  // install layout
  const repoCards = path.join(root, 'cards');                // repo layout
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(repoCards, { recursive: true });
  // Only repo/cards exists → fall back to it.
  assert.strictEqual(defaultCardsDir(libDir), repoCards);
  // Now install layout exists → prefer runtime/cards.
  fs.mkdirSync(runtimeCards, { recursive: true });
  assert.strictEqual(defaultCardsDir(libDir), runtimeCards);
});
