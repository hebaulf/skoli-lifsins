#!/bin/sh
# Fails if the answer-file canary marker appears anywhere except its three
# allowed lines. Checks the git INDEX (`git grep --cached`), i.e. exactly what
# the next commit will contain; in CI that equals the checked-out commit.
#
# Why this exists next to the gitleaks rule in .gitleaks.toml: gitleaks'
# built-in config skips any file named .gitleaks.toml entirely, so gitleaks
# can't police lines inside its own config. This script covers every file,
# including that one. Run by .githooks/pre-commit and by CI.
#
# The marker is read from the constant in src/server/content/answer-file.ts,
# so it is never written out in this script. Fails closed if it can't be found.
set -eu

CONST_FILE=src/server/content/answer-file.ts
marker=$(git show ":$CONST_FILE" 2>/dev/null |
  sed -n 's/^export const ANSWER_FILE_CANARY = "\([A-Z-]*\)";$/\1/p')

if [ -z "$marker" ] || [ "$(printf '%s\n' "$marker" | wc -l)" -ne 1 ]; then
  echo "canary check: couldn't read exactly one ANSWER_FILE_CANARY definition from $CONST_FILE." >&2
  exit 1
fi

# The only allowed lines, as "path:line content" (exact match).
allowed="$CONST_FILE:export const ANSWER_FILE_CANARY = \"$marker\";
.gitleaks.toml:regex = '''$marker'''
docs/PLAN.md:  \"_canary\": \"$marker\","

# "path:line" for every staged text line containing the marker (exit 1 = none).
found=$(git -c core.quotePath=false grep --cached -F -I --full-name -e "$marker" -- . || true)

bad=$(printf '%s\n' "$found" | grep -v -x -F "$allowed" | grep -v '^$' || true)

# Each allowed line exactly once (no duplicated copies, e.g. in a second
# JSON example).
dupes=$(printf '%s\n' "$found" | grep -x -F "$allowed" | sort | uniq -d || true)

if [ -n "$bad" ] || [ -n "$dupes" ]; then
  echo "canary check: the answer-file marker appears outside its allowed lines." >&2
  echo "This usually means an answer file (or part of one) is being committed." >&2
  printf '%s\n%s\n' "$bad" "$dupes" | grep -v '^$' | cut -d: -f1 | sort -u | sed 's/^/  /' >&2
  exit 1
fi

echo "canary check: marker only on its allowed lines."
