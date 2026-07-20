'use strict';
// Working-day math: given the schedule's working weekdays and the set of
// known absence dates (OOO/leave/holiday days detected by the gcal card, plus
// days with `skipped` receipts), find the LAST WORKING DAY before `now` and
// the lookback hours that reach back to its start. Pure + deterministic —
// calendar detection itself lives in the gcal card; this only does the math.
const DAY_MS = 24 * 60 * 60 * 1000;

const ymd = (d) => d.toISOString().slice(0, 10);

// scheduleDays: launchd Weekday numbers (0=Sun..6=Sat, 1-5 = weekdays).
function isWorkingDay(date, scheduleDays, absenceDates) {
  if (!scheduleDays.includes(date.getUTCDay())) return false;
  return !absenceDates.has(ymd(date));
}

// Walk back from yesterday to the most recent working day. Returns null if
// none found within maxLookbackDays (long leave — caller caps the window).
function lastWorkingDay(now, scheduleDays, absenceDates, maxLookbackDays = 14) {
  for (let i = 1; i <= maxLookbackDays; i++) {
    const d = new Date(now.getTime() - i * DAY_MS);
    if (isWorkingDay(d, scheduleDays, absenceDates)) return d;
  }
  return null;
}

// Lookback hours: from the start (00:00 UTC-of-day) of the last working day
// to now, floored at minHours so a normal Tuesday still gets its usual window.
function lookbackHours({ now, scheduleDays, absenceDates, minHours = 36, maxLookbackDays = 14 }) {
  const abs = absenceDates instanceof Set ? absenceDates : new Set(absenceDates || []);
  const last = lastWorkingDay(now, scheduleDays, abs, maxLookbackDays);
  if (!last) return maxLookbackDays * 24;
  const dayStart = new Date(`${ymd(last)}T00:00:00Z`);
  const hours = Math.ceil((now - dayStart) / 36e5);
  return Math.max(hours, minHours);
}

if (require.main === module) {
  // CLI for the skill: node workdays.js '<json>' -> {"lookback_hours":N,"last_working_day":"YYYY-MM-DD"}
  const args = JSON.parse(process.argv[2] || '{}');
  const now = args.now ? new Date(args.now) : new Date();
  const scheduleDays = args.schedule_days || [1, 2, 3, 4, 5];
  const absenceDates = new Set(args.absence_dates || []);
  const last = lastWorkingDay(now, scheduleDays, absenceDates, args.max_lookback_days || 14);
  process.stdout.write(JSON.stringify({
    lookback_hours: lookbackHours({ now, scheduleDays, absenceDates, minHours: args.min_hours || 36, maxLookbackDays: args.max_lookback_days || 14 }),
    last_working_day: last ? ymd(last) : null,
  }));
}

module.exports = { isWorkingDay, lastWorkingDay, lookbackHours };
