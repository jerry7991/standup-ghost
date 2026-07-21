'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { canvasUpsert, channelPost } = require('../runtime/lib/slack');

// Mock the Slack API. Lookups with contains_text resolve OUR section (before vs
// after the edit); lookups without it resolve all headers. Records every call.
function mockApi({ ownBefore = [], ownAfter = [], headers = [] } = {}) {
  const calls = [];
  let edited = false;
  const api = async (method, body) => {
    calls.push({ method, body });
    if (method === 'canvases.sections.lookup') {
      if (body.criteria && body.criteria.contains_text) return { sections: edited ? ownAfter : ownBefore };
      return { sections: headers };
    }
    if (method === 'canvases.edit') { edited = true; return { ok: true }; }
    if (method === 'chat.postMessage') return { ts: '111.222', channel: body.channel };
    if (method === 'chat.update') return { ts: body.ts, channel: body.channel };
    throw new Error(`unexpected method ${method}`);
  };
  return { api, calls };
}
const editOf = (calls) => calls.find((c) => c.method === 'canvases.edit').body.changes[0];

test('canvas: existing section is replaced in place (no duplicate)', async () => {
  const { api, calls } = mockApi({ ownBefore: [{ id: 'sec1' }], ownAfter: [{ id: 'sec1' }] });
  const r = await canvasUpsert({ api, canvasId: 'F1', matchText: '2026-07-21 — anup.s', markdown: '## x' });
  const change = editOf(calls);
  assert.strictEqual(change.operation, 'replace');
  assert.strictEqual(change.section_id, 'sec1');
  assert.strictEqual(change.document_content.type, 'markdown');
  assert.strictEqual(r.ok, true);
});

test('canvas: fresh section inserts before the topmost header (newest-on-top)', async () => {
  const { api, calls } = mockApi({ ownBefore: [], headers: [{ id: 'top' }], ownAfter: [{ id: 'new' }] });
  await canvasUpsert({ api, canvasId: 'F1', matchText: 'k', markdown: '## x' });
  const change = editOf(calls);
  assert.strictEqual(change.operation, 'insert_before');
  assert.strictEqual(change.section_id, 'top');
});

test('canvas: empty canvas inserts at start', async () => {
  const { api, calls } = mockApi({ ownBefore: [], headers: [], ownAfter: [{ id: 'new' }] });
  await canvasUpsert({ api, canvasId: 'F1', matchText: 'k', markdown: '## x' });
  assert.strictEqual(editOf(calls).operation, 'insert_at_start');
});

test('canvas: read-back that never resolves our heading fails loudly (→ pending)', async () => {
  const { api } = mockApi({ ownBefore: [], headers: [], ownAfter: [] }); // heading never appears
  await assert.rejects(
    () => canvasUpsert({ api, canvasId: 'F1', matchText: 'k', markdown: '## x', maxAttempts: 2 }),
    /read-back|failed after/,
  );
});

test('canvas: Slack ok:false propagates as a thrown error', async () => {
  const api = async () => { throw new Error('canvases.edit: missing_scope'); };
  await assert.rejects(() => canvasUpsert({ api, canvasId: 'F1', matchText: 'k', markdown: 'x', maxAttempts: 1 }), /missing_scope/);
});

test('channel: fresh post uses chat.postMessage; ts uses chat.update', async () => {
  const post = mockApi();
  const p = await channelPost({ api: post.api, channel: 'C1', text: 'hi' });
  assert.strictEqual(post.calls[0].method, 'chat.postMessage');
  assert.strictEqual(p.ts, '111.222');
  const upd = mockApi();
  const u = await channelPost({ api: upd.api, channel: 'C1', text: 'hi', ts: '9.9' });
  assert.strictEqual(upd.calls[0].method, 'chat.update');
  assert.strictEqual(u.ts, '9.9');
});

test('secrets: requireSecret reads the file and errors clearly when missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-sec-'));
  const file = path.join(dir, 'secrets.json');
  process.env.STANDUP_GHOST_SECRETS_FILE = file;
  delete require.cache[require.resolve('../runtime/lib/secrets')];
  const secrets = require('../runtime/lib/secrets');
  assert.throws(() => secrets.requireSecret('slack_bot_token'), /missing secret/);
  fs.writeFileSync(file, JSON.stringify({ slack_bot_token: 'xoxb-abc' }), { mode: 0o600 });
  assert.strictEqual(secrets.requireSecret('slack_bot_token'), 'xoxb-abc');
  delete process.env.STANDUP_GHOST_SECRETS_FILE;
});
