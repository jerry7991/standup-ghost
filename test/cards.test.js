'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseFrontmatter, validateCard, loadCards } = require('../runtime/lib/cards');

const write = (dir, name, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };
const fm = (lines) => `---\n${lines.join('\n')}\n---\nbody\n`;
const baseConfig = {
  sources: { jira: { enabled: true }, gcal: { enabled: false } },
  sinks: { 'slack-canvas': { enabled: true } },
  flavors: { atlassian: 'claudeai' },
  behavior: { allow_unreviewed_cards: false },
};

test('pinned grammar: flat keys + inline arrays only', () => {
  assert.ok(parseFrontmatter(fm(['kind: source', 'name: jira', 'tools: [a, b]']), 'c').fields.tools.length === 2);
  assert.ok(parseFrontmatter(fm(['nested:', '  child: 1']), 'c').error);
  assert.ok(parseFrontmatter(fm(['tools: [a,']), 'c').error);
  assert.ok(parseFrontmatter('no frontmatter', 'c').error);
});

test('unknown frontmatter key is a named validation error', () => {
  const { fields } = parseFrontmatter(fm(['kind: source', 'name: jira', 'surprise: x']), 'c');
  assert.ok(validateCard(fields, 'c').some((e) => e.includes('unknown key "surprise"')));
});

test('tool outside the per-kind enum is rejected', () => {
  const { fields } = parseFrontmatter(fm(['kind: source', 'name: jira', 'tools: [Bash]']), 'c');
  assert.ok(validateCard(fields, 'c').some((e) => e.includes('not in the source enum')));
  const sinkTry = parseFrontmatter(fm(['kind: sink', 'name: s', 'tools: [mcp__atlassian__searchJiraIssuesUsingJql]']), 'c').fields;
  assert.ok(validateCard(sinkTry, 'c').length > 0);
});

test('loadCards: unreviewed excluded without opt-in and flagged; disabled excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cards-'));
  write(path.join(dir, 'sources'), 'jira.md', fm([
    'kind: source', 'name: jira', 'connector: atlassian', 'reviewed: true',
    'tools-local: [mcp__atlassian__searchJiraIssuesUsingJql]',
    'tools-claudeai: [mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql]',
  ]));
  write(path.join(dir, 'sources'), 'gcal.md', fm([
    'kind: source', 'name: gcal', 'reviewed: true',
    'tools: [mcp__claude_ai_Google_Calendar__list_events]',
  ]));
  write(path.join(dir, 'sinks'), 'rogue.md', fm([
    'kind: sink', 'name: slack-canvas',
    'tools: [mcp__claude_ai_Slack__slack_update_canvas]',
  ]));
  const { cards, excluded } = loadCards(dir, baseConfig);
  assert.deepStrictEqual(cards.map((c) => c.name), ['jira']);
  assert.deepStrictEqual(cards[0].resolvedTools, ['mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql']);
  assert.ok(excluded.find((e) => e.name === 'sinks/rogue.md' && e.unreviewed));
  assert.ok(excluded.find((e) => e.name === 'sources/gcal.md' && e.reason === 'disabled in config'));
});

test('declared flavors: cli flavor with zero MCP tools is valid; mcp flavor picks the tool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cards3-'));
  write(path.join(dir, 'sources'), 'github.md', fm([
    'kind: source', 'name: github', 'connector: github', 'reviewed: true',
    'flavors: [cli, mcp]',
    'tools-mcp: [mcp__github__search_issues]',
    'cli: [gh, date]',
  ]));
  const cfg = (f) => ({ sources: { github: { enabled: true } }, sinks: {}, flavors: { github: f }, behavior: {} });
  const cli = loadCards(dir, cfg('cli'));
  assert.strictEqual(cli.cards.length, 1);
  assert.deepStrictEqual(cli.cards[0].resolvedTools, []);
  const mcp = loadCards(dir, cfg('mcp'));
  assert.deepStrictEqual(mcp.cards[0].resolvedTools, ['mcp__github__search_issues']);
  const unset = loadCards(dir, cfg(null));
  assert.strictEqual(unset.cards.length, 0);
  const bogus = loadCards(dir, cfg('carrier-pigeon'));
  assert.strictEqual(bogus.cards.length, 0);
});

test('flavor switch changes resolved tools; unresolved flavor excludes variant-only card', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cards2-'));
  write(path.join(dir, 'sources'), 'jira.md', fm([
    'kind: source', 'name: jira', 'connector: atlassian', 'reviewed: true',
    'tools-local: [mcp__atlassian__searchJiraIssuesUsingJql]',
    'tools-claudeai: [mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql]',
  ]));
  const local = loadCards(dir, { ...baseConfig, flavors: { atlassian: 'local' } });
  assert.deepStrictEqual(local.cards[0].resolvedTools, ['mcp__atlassian__searchJiraIssuesUsingJql']);
  const none = loadCards(dir, { ...baseConfig, flavors: {} });
  assert.strictEqual(none.cards.length, 0);
  assert.ok(none.excluded[0].reason.includes('flavor unresolved'));
});
