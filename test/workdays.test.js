'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { lastWorkingDay, lookbackHours, isWorkingDay } = require('../runtime/lib/workdays');

const WD = [1, 2, 3, 4, 5];
const at = (s) => new Date(s);

test('plain Tuesday: last working day is Monday, lookback floors at minHours', () => {
  const now = at('2026-07-21T09:30:00Z'); // Tue
  assert.strictEqual(lastWorkingDay(now, WD, new Set()).getUTCDay(), 1);
  assert.strictEqual(lookbackHours({ now, scheduleDays: WD, absenceDates: new Set(), minHours: 36 }), 36);
});

test('Monday: weekend is skipped, lookback reaches Friday start', () => {
  const now = at('2026-07-20T09:30:00Z'); // Mon
  const last = lastWorkingDay(now, WD, new Set());
  assert.strictEqual(last.toISOString().slice(0, 10), '2026-07-17'); // Fri
  const h = lookbackHours({ now, scheduleDays: WD, absenceDates: new Set(), minHours: 36 });
  assert.ok(h >= 72 && h <= 82, `expected ~78h, got ${h}`);
});

test('sick leave Thu+Fri: Monday looks back to Wednesday', () => {
  const now = at('2026-07-20T09:30:00Z'); // Mon
  const absences = new Set(['2026-07-16', '2026-07-17']); // Thu, Fri
  const last = lastWorkingDay(now, WD, absences);
  assert.strictEqual(last.toISOString().slice(0, 10), '2026-07-15'); // Wed
  const h = lookbackHours({ now, scheduleDays: WD, absenceDates: absences, minHours: 36 });
  assert.ok(h >= 120, `lookback must span the absence, got ${h}`);
});

test('long leave beyond maxLookbackDays caps the window instead of failing', () => {
  const now = at('2026-07-20T09:30:00Z');
  const abs = new Set();
  for (let i = 1; i <= 20; i++) abs.add(new Date(now - i * 864e5).toISOString().slice(0, 10));
  assert.strictEqual(lastWorkingDay(now, WD, abs, 14), null);
  assert.strictEqual(lookbackHours({ now, scheduleDays: WD, absenceDates: abs, maxLookbackDays: 14 }), 14 * 24);
});

test('weekend days are never working days regardless of absences', () => {
  assert.strictEqual(isWorkingDay(at('2026-07-18T00:00:00Z'), WD, new Set()), false); // Sat
  assert.strictEqual(isWorkingDay(at('2026-07-20T00:00:00Z'), WD, new Set()), true);  // Mon
});

test('CLI contract shape', () => {
  const { execFileSync } = require('child_process');
  const out = JSON.parse(execFileSync('node', [require.resolve('../runtime/lib/workdays'),
    JSON.stringify({ now: '2026-07-20T09:30:00Z', absence_dates: ['2026-07-17'] })]).toString());
  assert.strictEqual(out.last_working_day, '2026-07-16'); // Thu (Fri absent, weekend skipped)
  assert.ok(out.lookback_hours >= 96);
});
