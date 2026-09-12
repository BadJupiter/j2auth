#!/usr/bin/env bash
# Fail if any deployed copy of j2auth.js has drifted from this repo's canonical
# file.
#
# Six copies had quietly forked before the 2026-08-12 reconciliation — one of
# them with a real behavioral difference in the verify handler — because the
# only thing keeping them in sync was remembering to. This makes drift loud.
#
#   ./check-copies.sh            # check
#   ./check-copies.sh --fix      # overwrite the copies from canonical
#
# Run it from a pre-commit hook or CI. Exits non-zero on drift.

set -u

BASE="${JUPITER_BASE:-$HOME/dev-jupiter2}"
# civicgraph lives outside the Jupiter workspace, so it needs its own base.
DWORKS="${DWORKS_BASE:-$HOME/dev-dworks}"
# badgervision is its own Pages repo, outside both workspaces.
BVISION="${BVISION_BASE:-$HOME/badgervision}"
CANON="$(cd "$(dirname "$0")" && pwd)/j2auth.js"

# One copy per repo. Inside v2-client every sub-app loads ../j2auth.js, so the
# repo root is the only copy there — don't reintroduce per-app copies.
COPIES=(
  "$BASE/v2-client/j2auth.js"
  "$BASE/v2-db-feedback/docs/js/j2auth.js"
  "$DWORKS/civicgraph/docs/js/j2auth.js"
  "$BVISION/j2auth.js"
)

FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

hash_of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }

if [ ! -f "$CANON" ]; then
  echo "✗ canonical missing: $CANON" >&2
  exit 2
fi

want="$(hash_of "$CANON")"
drift=0

for f in "${COPIES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "✗ MISSING  $f"
    [ "$FIX" = 1 ] && mkdir -p "$(dirname "$f")" && cp "$CANON" "$f" && echo "  → restored"
    drift=1
    continue
  fi
  if [ "$(hash_of "$f")" != "$want" ]; then
    echo "✗ DRIFTED  $f"
    if [ "$FIX" = 1 ]; then
      cp "$CANON" "$f"
      echo "  → overwritten from canonical"
    else
      diff -u "$CANON" "$f" | head -40
    fi
    drift=1
  else
    echo "✓ $f"
  fi
done

# Catch anyone reintroducing a per-app copy inside v2-client. (Only v2-client
# — the other consumers have a single copy each by construction.)
strays="$(find "$BASE/v2-client" -name j2auth.js -not -path "$BASE/v2-client/j2auth.js" \
          -not -path '*/j2env/*' 2>/dev/null)"
if [ -n "$strays" ]; then
  echo "✗ STRAY per-app copies (apps should load ../j2auth.js):"
  echo "$strays" | sed 's/^/    /'
  drift=1
fi

if [ "$drift" = 1 ] && [ "$FIX" = 0 ]; then
  echo
  echo "Edit $CANON, then re-run with --fix." >&2
  exit 1
fi

exit 0
