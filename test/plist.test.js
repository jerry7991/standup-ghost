'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { render, calendarDicts } = require('../runtime/lib/plist');

const config = { schedule: { days: [1, 2, 3, 4, 5], hour: 9, minute: 30 } };

test('renders one dict per weekday with config hour/minute (local-time semantics)', () => {
  const out = render('main', config, '/tmp/rt');
  assert.strictEqual((out.match(/<key>Weekday<\/key>/g) || []).length, 5);
  assert.ok(out.includes('<key>Hour</key><integer>9</integer>'));
  assert.ok(out.includes('<key>Minute</key><integer>30</integer>'));
  assert.ok(out.includes('/tmp/rt/run.sh'));
  assert.ok(out.includes('com.standup-ghost.daily'));
});

test('watchdog offsets by 30 minutes and uses its own label/script', () => {
  const out = render('watchdog', config, '/tmp/rt');
  assert.ok(out.includes('com.standup-ghost.watchdog'));
  assert.ok(out.includes('/tmp/rt/watchdog.sh'));
  assert.ok(out.includes('<key>Minute</key><integer>0</integer>'));
  assert.ok(out.includes('<key>Hour</key><integer>10</integer>'));
});

test('render is deterministic', () => {
  assert.strictEqual(render('main', config, '/tmp/rt'), render('main', config, '/tmp/rt'));
});

test('no ~ anywhere — plists cannot expand it', () => {
  const out = render('main', config, '/tmp/rt');
  assert.ok(!/<string>~/.test(out));
});

test('calendarDicts shape', () => {
  const d = calendarDicts({ days: [3], hour: 11, minute: 20 });
  assert.ok(d.includes('Weekday</key><integer>3'));
});
