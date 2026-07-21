'use strict';
// Secrets for headless (token-flavor) transports. Kept OUT of config.json so
// the config can be echoed/shared freely; secrets live in a 0600 file beside it.
// Layout (R16): ~/.config/standup-ghost/secrets.json. Env override for tests only.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = process.env.STANDUP_GHOST_CONFIG_DIR || path.join(os.homedir(), '.config', 'standup-ghost');
const SECRETS_FILE = process.env.STANDUP_GHOST_SECRETS_FILE || path.join(CONFIG_DIR, 'secrets.json');

// Returns the parsed secrets object, or {} when absent. Warns (stderr) on a
// world/group-readable file — a leaked bot token is a real incident — but never
// throws on permissions, so a hardened setup can tighten later without breaking.
function loadSecrets() {
  let raw;
  try { raw = fs.readFileSync(SECRETS_FILE, 'utf8'); } catch { return {}; }
  try {
    const st = fs.statSync(SECRETS_FILE);
    if (st.mode & 0o077) process.stderr.write(`WARN: ${SECRETS_FILE} is group/world-accessible — chmod 600 it\n`);
  } catch {}
  try { return JSON.parse(raw); } catch (e) { throw new Error(`secrets.json parse error: ${e.message}`); }
}

// Resolve one required secret; a clear, actionable error when missing so the
// token flavor degrades to a `failed` pending with a fixable reason.
function requireSecret(key) {
  const v = loadSecrets()[key];
  if (!v || typeof v !== 'string') {
    throw new Error(`missing secret "${key}" in ${SECRETS_FILE} — add it (chmod 600) to use the token flavor`);
  }
  return v;
}

module.exports = { SECRETS_FILE, loadSecrets, requireSecret };
