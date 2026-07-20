#!/bin/zsh
# Release gate: fail if anything private is about to ship in TRACKED files.
# The repo ships only GENERIC patterns — your company/personal strings belong
# in your user profile, never in this public script:
#   ~/.config/standup-ghost/private-patterns.txt   (one regex per line, # comments ok)
#   ./.scan-patterns.local                          (repo-local, gitignored)
# gitleaks (if installed) covers secrets/tokens/entropy on top.
set -u
cd "$(dirname "$0")/.."

FAIL=0
# Generic, non-identifying patterns only.
PATTERNS=(
  '/Users/[a-z]'        # absolute macOS home paths
  '/home/[a-z]'         # absolute Linux home paths
)
for f in "$HOME/.config/standup-ghost/private-patterns.txt" "./.scan-patterns.local"; do
  if [[ -f "$f" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" || "$line" == \#* ]] && continue
      PATTERNS+=("$line")
    done < "$f"
    echo "ℹ️  loaded private patterns from $f"
  fi
done

# Only TRACKED files ship — judge those, not gitignored local artifacts.
for p in "${PATTERNS[@]}"; do
  hits=$(git ls-files -z | xargs -0 grep -lIiE "$p" 2>/dev/null | grep -v "scripts/$(basename "$0")" || true)
  if [[ -n "$hits" ]]; then
    echo "❌ pattern '$p' found in:"; echo "$hits"; FAIL=1
  fi
done

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-banner || FAIL=1
else
  echo "⚠️  gitleaks not installed — pattern greps only (brew install gitleaks for full coverage)"
fi

[[ $FAIL -eq 0 ]] && echo "✅ identifier scan clean" || echo "❌ identifier scan FAILED"
exit $FAIL
