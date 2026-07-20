# Card contract

A card is one markdown file under `cards/sources/` or `cards/sinks/` — the ONLY thing you add to teach standup-ghost a new source or sink. The core pipeline never changes for a new card.

## Frontmatter (pinned grammar — exactness over YAML)

Flat `key: value` and inline `key: [a, b]` lines ONLY. Nested maps, block sequences, and multiline values are **rejected with a named error** — a mis-parsed card must fail loudly, never silently corrupt the generated `--allowedTools`.

| Key | Required | Meaning |
|---|---|---|
| `kind` | yes | `source` or `sink` |
| `name` | yes | config key under `sources.` / `sinks.` (enable flag lives there) |
| `reviewed` | shipped cards | `true` only for cards merged via reviewed PR. Anything else is excluded unless the user sets `behavior.allow_unreviewed_cards`, and the doctor flags it distinctly. |
| `connector` | if variants | logical connector this card rides (e.g. `atlassian`) |
| `tools` | – | fixed MCP tool names (must be inside the per-kind enum) |
| `tools-<flavor>` | – | flavor-variant tool names; setup resolves which flavor exists per machine and records it in `config.flavors.<connector>` |
| `cli` | – | CLI binaries used (allowed: `gh`, `jq`, `node`, `date`) |
| `requires-config` | – | config path the doctor checks before calling the card healthy |

**Security invariant:** every declared tool must be inside the fixed per-kind enum in `runtime/lib/cards.js`. Widening that enum is a security-reviewed release-checklist change, never a card-local decision. The generated allowlist (`runtime/lib/allowlist.js`) is the single tool-list authority — skills carry no `allowed-tools` frontmatter.

## Body

Three sections, addressed to the LLM run:
1. **Probe** — how setup/doctor decides the card is available / degraded / missing, with exact remediation.
2. **Fetch** (source) / **Deliver** (sink) — the recipe, including every hard-won gotcha, dated.
3. **Output contract** — the compact shape handed to (or accepted from) the compose stage. Sources must emit bounded, privacy-safe data; sinks must define their idempotency mechanism and write delivery receipts.

## Degrade rules

A dark source lane = fewer bullets + a visible flag, never a dead run and never fabricated content. A failed sink = typed `failed` pending entry + wrapper alarm, never lost content.
