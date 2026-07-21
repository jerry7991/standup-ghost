'use strict';
// THE single authority for the headless run's --allowedTools string (R8).
// Composed from enabled cards' RESOLVED tool names + core tools. Skill files
// carry no allowed-tools frontmatter; nothing else may define a tool list.
const fs = require('fs');
const path = require('path');
const { loadCards } = require('./cards');
const state = require('./state');

const CORE_TOOLS = ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'ToolSearch', 'Skill'];

// Cards ship INSIDE the runtime bundle (`<runtime>/cards`) in an install, but
// sit beside runtime (`<repo>/cards`) in the repo. The old fixed `../../cards`
// only matched the repo layout, so an INSTALLED runner found zero cards and
// generated an MCP-less allowlist — every Slack/Jira/Calendar call then denied
// headless (silent, since the file sink still wrote a receipt). Resolve the
// first location that exists so both layouts work.
function defaultCardsDir(base = __dirname) {
  const candidates = [path.join(base, '..', 'cards'), path.join(base, '..', '..', 'cards')];
  return candidates.find((d) => { try { return fs.existsSync(d); } catch { return false; } }) || candidates[0];
}

function compose(config, cardsDir) {
  const { cards, excluded } = loadCards(cardsDir, config);
  const tools = new Set(CORE_TOOLS);
  for (const c of cards) for (const t of c.resolvedTools) tools.add(t);
  return { allow: [...tools].sort().join(','), cards, excluded };
}

if (require.main === module) {
  const config = state.loadConfig();
  if (!config) { console.error('no config at ' + state.CONFIG_DIR); process.exit(1); }
  const cardsDir = process.env.STANDUP_GHOST_CARDS_DIR || defaultCardsDir();
  process.stdout.write(compose(config, cardsDir).allow);
}

module.exports = { compose, CORE_TOOLS, defaultCardsDir };
