'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = require.resolve('../runtime/session_scan');
const SECRET = 'TOP-SECRET-TOKEN-abc123-should-never-leak';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-projects-'));
  const proj = path.join(root, '-Users-testuser-Desktop-myrepo');
  fs.mkdirSync(proj, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'summary', summary: 'Fix the login flow ' + 'x'.repeat(500) }),
    JSON.stringify({ type: 'user', gitBranch: 'PROJ-42-login-fix', message: { content: 'Please fix the login bug. ' + 'y'.repeat(600) } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: SECRET }] } }),
    JSON.stringify({ type: 'user', message: { content: 'thanks, also add a test' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: SECRET }] } }),
  ];
  fs.writeFileSync(path.join(proj, 'session-1.jsonl'), lines.join('\n'));
  // trivial session that must be dropped
  fs.writeFileSync(path.join(proj, 'session-2.jsonl'), JSON.stringify({ type: 'user', message: { content: 'hi' } }));
  return root;
}

const run = (root, extra = []) => JSON.parse(execFileSync('node', [SCRIPT, '--hours', '24', ...extra],
  { env: { ...process.env, STANDUP_GHOST_PROJECTS_DIR: root } }).toString());

test('emits bounded summaries only — no raw transcript or tool-output leakage', () => {
  const out = run(fixture());
  assert.strictEqual(out.length, 1);
  const s = out[0];
  const flat = JSON.stringify(s);
  assert.ok(!flat.includes(SECRET), 'raw transcript content leaked');
  assert.ok(s.firstAsk.length <= 250);
  for (const sum of s.summaries) assert.ok(sum.length <= 200);
  assert.strictEqual(s.branch, 'PROJ-42-login-fix');
  assert.strictEqual(s.userTurns, 2);
  assert.ok(s.project === 'Desktop-myrepo');
});

test('empty projects dir emits []', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-empty-'));
  assert.deepStrictEqual(run(empty), []);
});
