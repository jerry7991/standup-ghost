'use strict';
// Tiny CLI over state.js for the shell wrappers (run.sh / watchdog.sh).
// Verbs:
//   skipped-receipt <reason>   write today's `skipped` receipt (pause/absence/concurrent)
//   status                     JSON: today's receipt, failed-pending day count, markers, receipt age
const state = require('./state');

const today = () => new Date().toISOString().slice(0, 10);
const ageDays = () => {
  const a = state.lastReceiptAgeDays();
  return Number.isFinite(a) ? Math.min(Number(a.toFixed(2)), 9999) : 9999;
};
const verb = process.argv[2];

if (verb === 'skipped-receipt') {
  state.writeReceipt({ date: today(), sink: 'run', provenance: 'skipped', data: { reason: process.argv[3] || 'unspecified' } });
  process.stdout.write('ok');
} else if (verb === 'status') {
  const config = state.loadConfig() || {};
  const maxAge = (config.behavior && config.behavior.pending_max_age_days) || 7;
  state.prunePending(new Date(), maxAge);
  state.pruneReceipts();
  const pendingFailedDays = new Set(state.listPending().filter((p) => p.type === 'failed').map((p) => p.date)).size;
  const todaysReceipts = state.listReceipts().filter((r) => r.date === today() && r.provenance !== 'expired');
  // Per-sink truth: a sink that failed TODAY must alarm same-day, even when
  // another sink (e.g. file) succeeded — else `today_receipt` masks the failure.
  const todayFailedSinks = [...new Set(
    state.listPending().filter((p) => p.type === 'failed' && p.date === today()).map((p) => p.sink),
  )];
  process.stdout.write(JSON.stringify({
    today_receipt: todaysReceipts.length > 0,
    today_failed_sinks: todayFailedSinks,
    pending_failed_days: pendingFailedDays,
    state_corrupt: Boolean(state.getMarker('state-corrupt')),
    paused: Boolean(state.getMarker('paused')),
    last_receipt_age_days: ageDays(), // any non-finite value would JSON-null and mute the watchdog
    alarm_threshold_days: (config.behavior && config.behavior.alarm_threshold_days) || 2,
    notify_on_post: Boolean(config.behavior && config.behavior.notify_on_post),
  }));
} else {
  console.error('usage: statecli.js skipped-receipt <reason> | status');
  process.exit(2);
}
