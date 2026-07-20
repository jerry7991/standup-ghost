#!/usr/bin/env node
'use strict';
// Zero-dependency Claude Code session scanner. PRIVACY CONTRACT: emits ONLY
// bounded summaries (project, branch, summary titles, <=250-char first ask,
// counts) — raw transcript content never leaves this process.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const argv = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const HOURS = parseFloat(argv('--hours', '36'));
const MAX = parseInt(argv('--max', '25'), 10);
const MIN_TURNS = parseInt(argv('--min-turns', '2'), 10);
const ROOT = process.env.STANDUP_GHOST_PROJECTS_DIR || path.join(process.env.HOME, '.claude', 'projects');
const CUTOFF = Date.now() - HOURS * 3600 * 1000;
const ASK_CAP = 250;
const SUMMARY_CAP = 200;
const MAX_SUMMARIES = 3;

async function scanFile(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const summaries = new Set();
  let firstAsk = null;
  let userTurns = 0;
  let branch = null;
  for await (const line of rl) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'summary' && e.summary) summaries.add(String(e.summary).slice(0, SUMMARY_CAP));
    if (e.gitBranch && !branch) branch = e.gitBranch;
    if (e.type === 'user' && e.message && !e.isMeta) {
      const c = e.message.content;
      const text = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((p) => p.type === 'text').map((p) => p.text).join(' ') : '';
      const t = (text || '').trim();
      // Skip tool-results (no text parts), slash-command wrappers, injected turns.
      if (t && !t.startsWith('<')) {
        userTurns++;
        if (!firstAsk) firstAsk = t.slice(0, ASK_CAP);
      }
    }
  }
  return { summaries: [...summaries].slice(-MAX_SUMMARIES), firstAsk, userTurns, branch };
}

(async () => {
  const candidates = [];
  let projects = [];
  try { projects = fs.readdirSync(ROOT); } catch { console.log('[]'); return; }
  for (const proj of projects) {
    const dir = path.join(ROOT, proj);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      let st;
      try { st = fs.statSync(path.join(dir, f)); } catch { continue; }
      if (st.mtimeMs < CUTOFF) continue;
      candidates.push({ project: proj, file: path.join(dir, f), mtimeMs: st.mtimeMs, sizeKB: Math.round(st.size / 1024) });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const results = [];
  for (const s of candidates.slice(0, MAX)) {
    let d;
    try { d = await scanFile(s.file); } catch { continue; }
    if (d.userTurns < MIN_TURNS && d.summaries.length === 0) continue;
    results.push({
      project: s.project.replace(/^-Users-[^-]+-/, ''),
      mtime: new Date(s.mtimeMs).toISOString(),
      sizeKB: s.sizeKB,
      branch: d.branch,
      userTurns: d.userTurns,
      summaries: d.summaries,
      firstAsk: d.firstAsk,
    });
  }
  console.log(JSON.stringify(results, null, 1));
})();
