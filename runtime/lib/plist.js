'use strict';
// Renders the launchd plists (main + watchdog) from config. plists cannot
// expand ~, so absolute paths are baked at render time. Local-time semantics:
// launchd StartCalendarInterval uses the machine's local timezone.
const fs = require('fs');
const path = require('path');
const os = require('os');

function calendarDicts({ days, hour, minute }) {
  return days.map((d) =>
    `    <dict><key>Weekday</key><integer>${d}</integer><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`
  ).join('\n');
}

function render(kind, config, runtimeDir) {
  const tmplName = kind === 'watchdog' ? 'com.standup-ghost.watchdog.plist.tmpl' : 'com.standup-ghost.plist.tmpl';
  const tmpl = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', tmplName), 'utf8');
  const sched = { ...config.schedule };
  if (kind === 'watchdog') { sched.minute = (sched.minute + 30) % 60; sched.hour = sched.minute < config.schedule.minute ? sched.hour + 1 : sched.hour; }
  const script = kind === 'watchdog' ? 'watchdog.sh' : 'run.sh';
  return tmpl
    .replaceAll('{{RUNTIME_SCRIPT}}', path.join(runtimeDir, script))
    .replaceAll('{{LOG}}', path.join(os.homedir(), 'Library', 'Logs', `standup-ghost.${kind === 'watchdog' ? 'watchdog.' : ''}launchd.log`))
    .replaceAll('{{CALENDAR_DICTS}}', calendarDicts(sched));
}

if (require.main === module) {
  const kind = process.argv[2] || 'main';
  const state = require('./state');
  const config = state.loadConfig();
  if (!config) { console.error('no config'); process.exit(1); }
  const runtimeDir = process.env.STANDUP_GHOST_RUNTIME_DIR
    || path.join(os.homedir(), '.local', 'share', 'standup-ghost', 'runtime');
  process.stdout.write(render(kind, config, runtimeDir));
}

module.exports = { render, calendarDicts };
