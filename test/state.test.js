'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-state-'));
process.env.STANDUP_GHOST_CONFIG_DIR = path.join(tmp, 'config');
process.env.STANDUP_GHOST_STATE_DIR = path.join(tmp, 'state');
const state = require('../runtime/lib/state');

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

test('held pending is never flushable; failed is', () => {
  state.addPending({ date: daysAgo(1), sink: 'slack-canvas', type: 'held', content: 'x' });
  state.addPending({ date: daysAgo(1), sink: 'slack-channel', type: 'failed', content: 'y' });
  const f = state.flushable(new Date(), 7);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].type, 'failed');
});

test('failed pending older than maxAge expires with a receipt note, never posts', () => {
  state.addPending({ date: daysAgo(10), sink: 'slack-channel', type: 'failed', content: 'old' });
  assert.strictEqual(state.flushable(new Date(), 7).some((p) => p.date === daysAgo(10)), false);
  const expired = state.prunePending(new Date(), 7);
  assert.ok(expired.some((p) => p.date === daysAgo(10)));
  const r = state.getReceipt(daysAgo(10), 'slack-channel');
  assert.strictEqual(r.provenance, 'expired');
});

test('receipts record provenance and drive lastReceiptAgeDays', () => {
  state.writeReceipt({ date: daysAgo(0), sink: 'slack-canvas', provenance: 'scheduled', data: { ts: '123.45' } });
  assert.strictEqual(state.getReceipt(daysAgo(0), 'slack-canvas').provenance, 'scheduled');
  assert.ok(state.lastReceiptAgeDays() < 1);
  assert.throws(() => state.writeReceipt({ date: daysAgo(0), sink: 'x', provenance: 'nope' }));
});

test('lock: second entrant refused; release frees it', () => {
  assert.strictEqual(state.acquireLock(), true);
  assert.strictEqual(state.acquireLock(), false);
  state.releaseLock();
  assert.strictEqual(state.acquireLock(), true);
  state.releaseLock();
});

test('corrupt state quarantines + sets marker, does not throw', () => {
  const f = path.join(state.STATE_DIR, 'setup-state.json');
  state.setSetupState('configured');
  fs.writeFileSync(f, '{not json');
  const got = state.readJson(f);
  assert.strictEqual(got, null);
  assert.ok(state.getMarker('state-corrupt'));
  assert.ok(fs.readdirSync(state.STATE_DIR).some((x) => x.startsWith('setup-state.json.corrupt-')));
  state.clearMarker('state-corrupt');
});

test('state files are 0600, dirs 0700', () => {
  state.writeReceipt({ date: daysAgo(0), sink: 'file', provenance: 'manual' });
  const mode = fs.statSync(path.join(state.RECEIPTS_DIR, `${daysAgo(0)}__file.json`)).mode & 0o777;
  assert.strictEqual(mode, 0o600);
  const dmode = fs.statSync(state.STATE_DIR).mode & 0o777;
  assert.strictEqual(dmode, 0o700);
});

test('setup state machine accepts only known states', () => {
  state.setSetupState('live');
  assert.strictEqual(state.getSetupState().state, 'live');
  assert.throws(() => state.setSetupState('bogus'));
});
