'use strict';
// THE single authority for the headless run's --allowedTools string (R8).
// Composed from enabled cards' RESOLVED tool names + core tools. Skill files
// carry no allowed-tools frontmatter; nothing else may define a tool list.
const path = require('path');
const { loadCards } = require('./cards');
const state = require('./state');

const CORE_TOOLS = ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'ToolSearch', 'Skill'];

function compose(config, cardsDir) {
  const { cards, excluded } = loadCards(cardsDir, config);
  const tools = new Set(CORE_TOOLS);
  for (const c of cards) for (const t of c.resolvedTools) tools.add(t);
  return { allow: [...tools].sort().join(','), cards, excluded };
}

if (require.main === module) {
  const config = state.loadConfig();
  if (!config) { console.error('no config at ' + state.CONFIG_DIR); process.exit(1); }
  const cardsDir = process.env.STANDUP_GHOST_CARDS_DIR || path.join(__dirname, '..', '..', 'cards');
  process.stdout.write(compose(config, cardsDir).allow);
}

module.exports = { compose, CORE_TOOLS };
