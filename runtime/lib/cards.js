'use strict';
// Card discovery + validation. Cards are markdown with PINNED-GRAMMAR frontmatter:
// flat `key: value` and inline `key: [a, b]` ONLY — nesting/multiline rejected
// with a named error so community cards can't silently corrupt the allowlist.
// Safety (R8): declared tools must sit inside a fixed per-kind enum; cards not
// marked `reviewed: true` are excluded unless config opts in, and always flagged.
const fs = require('fs');
const path = require('path');

// Fixed per-kind capability enums. Widening this list is a security-reviewed
// change (release checklist), never a card-local decision.
const ENUMS = {
  source: new Set([
    'mcp__atlassian__searchJiraIssuesUsingJql',
    'mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql',
    'mcp__claude_ai_Google_Calendar__list_events',
    'mcp__github__search_issues',
  ]),
  sink: new Set([
    'mcp__claude_ai_Slack__slack_read_canvas',
    'mcp__claude_ai_Slack__slack_update_canvas',
    'mcp__claude_ai_Slack__slack_send_message',
  ]),
};
const ALLOWED_CLI = new Set(['gh', 'jq', 'node', 'date']);

function parseFrontmatter(text, cardName) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: `${cardName}: missing frontmatter` };
  const fields = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') return { fields };
    if (!line.trim()) continue;
    if (/^\s/.test(line)) return { error: `${cardName}: nested/indented frontmatter not allowed (line ${i + 1})` };
    const m = line.match(/^([a-z0-9-]+):\s*(.*)$/);
    if (!m) return { error: `${cardName}: unparseable frontmatter line ${i + 1}: "${line}"` };
    const [, key, raw] = m;
    if (raw.startsWith('[')) {
      if (!raw.endsWith(']')) return { error: `${cardName}: array must be inline on one line (${key})` };
      fields[key] = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      fields[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
    }
  }
  return { error: `${cardName}: unterminated frontmatter` };
}

const KNOWN_KEYS = new Set(['kind', 'name', 'connector', 'reviewed', 'tools', 'cli', 'requires-config', 'flavors']);
const isVariantKey = (k) => /^tools-[a-z0-9-]+$/.test(k);

function validateCard(fields, cardName) {
  const errors = [];
  for (const k of Object.keys(fields)) {
    if (!KNOWN_KEYS.has(k) && !isVariantKey(k)) errors.push(`${cardName}: unknown key "${k}"`);
  }
  if (fields.kind !== 'source' && fields.kind !== 'sink') errors.push(`${cardName}: kind must be source|sink`);
  if (!fields.name) errors.push(`${cardName}: name required`);
  const en = ENUMS[fields.kind] || new Set();
  const toolLists = [fields.tools || []];
  for (const k of Object.keys(fields)) if (isVariantKey(k)) toolLists.push(fields[k]);
  for (const list of toolLists) for (const t of list) {
    if (!en.has(t)) errors.push(`${cardName}: tool "${t}" not in the ${fields.kind} enum`);
  }
  for (const c of fields.cli || []) {
    if (!ALLOWED_CLI.has(c)) errors.push(`${cardName}: cli "${c}" not allowed`);
  }
  return errors;
}

// Resolve a card's effective tools for this machine: fixed `tools` plus the
// variant matching config.flavors[connector]. A card may declare its valid
// flavor names in `flavors:` — a chosen flavor with no tools-<flavor> variant
// is then legitimate (e.g. github's `cli` flavor uses gh, zero MCP tools).
// Multi-flavor cards with an unresolved flavor are unusable (excluded, run degrades).
function resolveTools(fields, config) {
  const fixed = fields.tools || [];
  const variantKeys = Object.keys(fields).filter(isVariantKey);
  const declared = fields.flavors || [];
  if (!variantKeys.length && !declared.length) return { tools: fixed };
  const flavor = fields.connector && config.flavors ? config.flavors[fields.connector] : null;
  if (!flavor) return { unresolved: true, tools: fixed };
  if (declared.length && !declared.includes(flavor)) return { unresolved: true, tools: fixed };
  const variant = fields[`tools-${flavor}`];
  if (!variant && !declared.includes(flavor)) return { unresolved: true, tools: fixed };
  return { tools: [...fixed, ...(variant || [])] };
}

function isEnabled(fields, config) {
  const bucket = fields.kind === 'source' ? config.sources : config.sinks;
  return Boolean(bucket && bucket[fields.name] && bucket[fields.name].enabled);
}

function loadCards(cardsDir, config) {
  const cards = [];
  const excluded = [];
  for (const kind of ['sources', 'sinks']) {
    const dir = path.join(cardsDir, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const cardName = `${kind}/${f}`;
      const { fields, error } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'), cardName);
      if (error) { excluded.push({ name: cardName, reason: error }); continue; }
      const errs = validateCard(fields, cardName);
      if (errs.length) { excluded.push({ name: cardName, reason: errs.join('; ') }); continue; }
      if (fields.reviewed !== true && !(config.behavior && config.behavior.allow_unreviewed_cards)) {
        excluded.push({ name: cardName, reason: 'unreviewed card — set behavior.allow_unreviewed_cards to opt in', unreviewed: true });
        continue;
      }
      if (!isEnabled(fields, config)) { excluded.push({ name: cardName, reason: 'disabled in config' }); continue; }
      const res = resolveTools(fields, config);
      if (res.unresolved && !res.tools.length) {
        excluded.push({ name: cardName, reason: `connector flavor unresolved (${fields.connector}) — run setup/doctor` });
        continue;
      }
      cards.push({ ...fields, file: path.join(dir, f), resolvedTools: res.tools, unreviewed: fields.reviewed !== true });
    }
  }
  return { cards, excluded };
}

module.exports = { parseFrontmatter, validateCard, resolveTools, loadCards, ENUMS, ALLOWED_CLI };
