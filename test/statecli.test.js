'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// statecli `status` must surface a sink that failed TODAY, so the runner can
// alarm same-day instead of being masked by another sink's success (the bug
// that silenced the 07-21 Slack failure — file sink succeeded, no alarm).
test('status.today_failed_sinks lists sinks with a failed pending dated today', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cli-'));
  const env = { ...process.env, STANDUP_GHOST_STATE_DIR: stateDir, STANDUP_GHOST_CONFIG_DIR: stateDir };

  const today = new Date().toISOString().slice(0, 10);
  const cli = path.join(__dirname, '..', 'runtime', 'lib', 'statecli.js');

  // No failures yet.
  let status = JSON.parse(execFileSync('node', [cli, 'status'], { env }).toString());
  assert.deepStrictEqual(status.today_failed_sinks, []);
  assert.strictEqual(status.today_receipt, false);

  // A file-sink success today...
  delete require.cache[require.resolve('../runtime/lib/state')];
  process.env.STANDUP_GHOST_STATE_DIR = stateDir;
  process.env.STANDUP_GHOST_CONFIG_DIR = stateDir;
  const state = require('../runtime/lib/state');
  state.writeReceipt({ date: today, sink: 'file', provenance: 'scheduled' });
  // ...but the slack-canvas sink FAILED today.
  state.addPending({ date: today, sink: 'slack-canvas', type: 'failed', content: '## x' });

  status = JSON.parse(execFileSync('node', [cli, 'status'], { env }).toString());
  assert.strictEqual(status.today_receipt, true, 'file receipt exists');
  assert.deepStrictEqual(status.today_failed_sinks, ['slack-canvas'], 'same-day Slack failure surfaced despite file success');

  delete process.env.STANDUP_GHOST_STATE_DIR;
  delete process.env.STANDUP_GHOST_CONFIG_DIR;
});
