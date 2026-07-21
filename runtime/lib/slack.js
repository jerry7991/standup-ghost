#!/usr/bin/env node
'use strict';
// Slack "token" flavor — the HEADLESS transport for the Slack sinks. Talks to
// the Slack Web API directly over HTTPS with a bot token, so a launchd/cron run
// can deliver WITHOUT the interactive claude.ai Slack connector (which is absent
// in `claude -p`). No new MCP tool, no ALLOWED_CLI change: pure node + fetch.
//
// Canvas idempotency mirrors the claude.ai flavor's VERIFIED contract
// (cards/sinks/slack-canvas.md): upsert our own day section by its unique
// heading text, newest-on-top for a fresh section, and a MANDATORY read-back.
// Slack's per-header section-replace scope is under-documented, so read-back is
// the safety gate: if our heading isn't present exactly once after the write,
// we retry then FAIL (→ `failed` pending), never leave the shared canvas wrong.
const fs = require('fs');
const { requireSecret } = require('./secrets');

const SLACK_API = process.env.STANDUP_GHOST_SLACK_API_BASE || 'https://slack.com/api';

// Low-level call. Throws on transport error or `ok:false` (carrying Slack's
// error string, e.g. `not_authed`, `canvas_not_found`, `missing_scope`).
async function slackApi(token, method, body) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await res.json(); } catch { throw new Error(`${method}: non-JSON response (HTTP ${res.status})`); }
  if (!json.ok) throw new Error(`${method}: ${json.error || `HTTP ${res.status}`}`);
  return json;
}

const mdContent = (markdown) => ({ type: 'markdown', markdown });

// Find our own day section by the unique heading text (date + handle).
async function findOwn(api, canvasId, matchText) {
  const r = await api('canvases.sections.lookup', {
    canvas_id: canvasId,
    criteria: { section_types: ['any_header'], contains_text: matchText },
  });
  return r.sections || [];
}

// Idempotent upsert of OUR day block. `api` is injectable for tests.
async function canvasUpsert({ api, canvasId, matchText, markdown, maxAttempts = 3 }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const own = await findOwn(api, canvasId, matchText);
      let change;
      if (own.length) {
        // Replace our existing block (heading + body) in place — no duplicate.
        change = { operation: 'replace', section_id: own[0].id, document_content: mdContent(markdown) };
      } else {
        // New block: newest-on-top before the topmost header, else start of canvas.
        const heads = (await api('canvases.sections.lookup', {
          canvas_id: canvasId, criteria: { section_types: ['any_header'] },
        })).sections || [];
        change = heads.length
          ? { operation: 'insert_before', section_id: heads[0].id, document_content: mdContent(markdown) }
          : { operation: 'insert_at_start', document_content: mdContent(markdown) };
      }
      await api('canvases.edit', { canvas_id: canvasId, changes: [change] });

      // MANDATORY read-back: our heading must now resolve to exactly one section.
      const after = await findOwn(api, canvasId, matchText);
      if (after.length === 1) {
        return { ok: true, section_heading: matchText, operation: change.operation, attempts: attempt };
      }
      lastErr = new Error(`read-back found ${after.length} sections for our heading (want 1)`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`canvas upsert failed after ${maxAttempts} attempts: ${lastErr && lastErr.message}`);
}

// Channel post/update. Streams can't re-insert, so a same-day re-run updates by
// stored `ts` (caller passes it from the receipt); otherwise a fresh post.
async function channelPost({ api, channel, text, ts }) {
  const r = ts
    ? await api('chat.update', { channel, ts, text })
    : await api('chat.postMessage', { channel, text });
  return { ok: true, ts: r.ts, channel: r.channel || channel };
}

module.exports = { slackApi, canvasUpsert, channelPost, findOwn };

// --- CLI ---------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
  const readBody = () => {
    const f = flag('--body-file');
    if (!f) throw new Error('--body-file required');
    return fs.readFileSync(f, 'utf8');
  };

  (async () => {
    const token = process.env.STANDUP_GHOST_SLACK_TOKEN || requireSecret('slack_bot_token');
    const api = (method, body) => slackApi(token, method, body);
    let out;
    if (cmd === 'canvas-upsert') {
      const canvasId = flag('--canvas');
      const matchText = flag('--match');
      if (!canvasId || !matchText) throw new Error('canvas-upsert needs --canvas and --match');
      out = await canvasUpsert({ api, canvasId, matchText, markdown: readBody() });
    } else if (cmd === 'channel-post') {
      const channel = flag('--channel');
      if (!channel) throw new Error('channel-post needs --channel');
      out = await channelPost({ api, channel, text: readBody(), ts: flag('--ts') });
    } else {
      throw new Error(`unknown command "${cmd}" (want canvas-upsert | channel-post)`);
    }
    process.stdout.write(JSON.stringify(out));
  })().catch((e) => { process.stderr.write(String(e.message) + '\n'); process.exit(1); });
}
