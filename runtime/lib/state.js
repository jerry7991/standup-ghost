'use strict';
// Deterministic state layer: typed pending, delivery receipts, run lock,
// corruption quarantine, markers. Zero dependencies.
// Layout (R16): config in ~/.config/standup-ghost, state in ~/.local/state/standup-ghost.
// Env overrides exist for tests only.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = process.env.STANDUP_GHOST_CONFIG_DIR || path.join(os.homedir(), '.config', 'standup-ghost');
const STATE_DIR = process.env.STANDUP_GHOST_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'standup-ghost');
const PENDING_DIR = path.join(STATE_DIR, 'pending');
const RECEIPTS_DIR = path.join(STATE_DIR, 'receipts');
const LOCK_DIR = path.join(STATE_DIR, '.run-lock');
const LOCK_STALE_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECEIPT_RETENTION_DAYS = 90;
const HELD_RETENTION_DAYS = 7;

function ensureDirs() {
  for (const d of [CONFIG_DIR, STATE_DIR, PENDING_DIR, RECEIPTS_DIR]) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
}

function writeJson(file, obj) {
  ensureDirs();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file); // atomic on same fs
}

// Corrupt state degrades LOUDLY: quarantine + marker; callers hold delivery
// until doctor clears it. Never silently "start clean" (would re-post days).
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    const q = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, q);
    setMarker('state-corrupt', { file, quarantined: q, error: String(e.message) });
    return null;
  }
}

// --- markers ('state-corrupt', 'paused') ---
const markerPath = (name) => path.join(STATE_DIR, `marker-${name}.json`);
function setMarker(name, data = {}) { writeJson(markerPath(name), { at: new Date().toISOString(), ...data }); }
function getMarker(name) { return readJson(markerPath(name)); }
function clearMarker(name) { try { fs.unlinkSync(markerPath(name)); } catch {} }

// --- run lock (mkdir-based; overlapping scheduled/manual runs serialize) ---
function acquireLock() {
  ensureDirs();
  try {
    fs.mkdirSync(LOCK_DIR);
    fs.writeFileSync(path.join(LOCK_DIR, 'pid'), String(process.pid), { mode: 0o600 });
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        return acquireLock();
      }
    } catch {}
    return false;
  }
}
function releaseLock() { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); }

// --- typed pending: 'failed' auto-flushes; 'held' never does ---
const pendingPath = (date, sink, type) => path.join(PENDING_DIR, `${date}__${sink}__${type}.json`);
function addPending({ date, sink, type, content }) {
  if (type !== 'failed' && type !== 'held') throw new Error(`bad pending type: ${type}`);
  writeJson(pendingPath(date, sink, type), { date, sink, type, content, at: new Date().toISOString() });
}
function listPending() {
  ensureDirs();
  return fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(PENDING_DIR, f))).filter(Boolean);
}
function flushable(now = new Date(), maxAgeDays = 7) {
  return listPending().filter((p) => p.type === 'failed' &&
    (now - new Date(p.date)) <= maxAgeDays * DAY_MS);
}
function removePending(date, sink, type) { try { fs.unlinkSync(pendingPath(date, sink, type)); } catch {} }
// Expiry: old 'failed' entries expire with a receipt note (never silently);
// 'held' entries superseded by newer days are pruned after HELD_RETENTION_DAYS.
function prunePending(now = new Date(), maxAgeDays = 7) {
  const expired = [];
  for (const p of listPending()) {
    const age = now - new Date(p.date);
    if (p.type === 'failed' && age > maxAgeDays * DAY_MS) {
      writeReceipt({ date: p.date, sink: p.sink, provenance: 'expired', data: { note: 'failed pending expired unposted' } });
      removePending(p.date, p.sink, p.type); expired.push(p);
    }
    if (p.type === 'held' && age > HELD_RETENTION_DAYS * DAY_MS) {
      removePending(p.date, p.sink, p.type); expired.push(p);
    }
  }
  return expired;
}

// --- receipts: single source of "delivered" truth; provenance matters ---
const receiptPath = (date, sink) => path.join(RECEIPTS_DIR, `${date}__${sink}.json`);
function writeReceipt({ date, sink, provenance, data = {} }) {
  if (!['scheduled', 'kickstart', 'manual', 'skipped', 'expired'].includes(provenance)) {
    throw new Error(`bad provenance: ${provenance}`);
  }
  writeJson(receiptPath(date, sink), { date, sink, provenance, at: new Date().toISOString(), ...data });
}
function getReceipt(date, sink) { return readJson(receiptPath(date, sink)); }
function listReceipts() {
  ensureDirs();
  return fs.readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(RECEIPTS_DIR, f))).filter(Boolean);
}
// Receipts predating `at` yield NaN, which poisons Math.max and mutes the alarm.
function receiptStamp(r) {
  for (const v of [r && r.at, r && r.date]) {
    const t = +new Date(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}
function lastReceiptAgeDays(now = new Date()) {
  const stamps = listReceipts().map(receiptStamp).filter((t) => t !== null);
  if (!stamps.length) return Infinity;
  return (now - Math.max(...stamps)) / DAY_MS;
}
function pruneReceipts(now = new Date()) {
  for (const r of listReceipts()) {
    if ((now - new Date(r.at)) > RECEIPT_RETENTION_DAYS * DAY_MS) {
      try { fs.unlinkSync(receiptPath(r.date, r.sink)); } catch {}
    }
  }
}

// --- setup state machine: configured -> verified-post -> scheduled -> live ---
const SETUP_STATES = ['configured', 'verified-post', 'scheduled', 'live'];
const setupPath = () => path.join(STATE_DIR, 'setup-state.json');
function getSetupState() { return readJson(setupPath()) || { state: null }; }
function setSetupState(state, extra = {}) {
  if (!SETUP_STATES.includes(state)) throw new Error(`bad setup state: ${state}`);
  writeJson(setupPath(), { state, at: new Date().toISOString(), ...extra });
}

function loadConfig() { return readJson(path.join(CONFIG_DIR, 'config.json')); }

module.exports = {
  CONFIG_DIR, STATE_DIR, PENDING_DIR, RECEIPTS_DIR, SETUP_STATES,
  ensureDirs, readJson, writeJson, loadConfig,
  setMarker, getMarker, clearMarker,
  acquireLock, releaseLock,
  addPending, listPending, flushable, removePending, prunePending,
  writeReceipt, getReceipt, listReceipts, lastReceiptAgeDays, pruneReceipts,
  getSetupState, setSetupState,
};
