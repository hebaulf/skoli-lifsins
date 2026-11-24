#!/bin/sh
# Fails if an answer-key data file is committed to this (PUBLIC) repo.
# Correct answers and explanations live only in Neon, loaded by
# `pnpm seed:answers <path>` from a file OUTSIDE the repo (docs/PLAN.md, Phase 5).
#
# Matches data files (json, csv, tsv, yaml, yml, txt, xlsx) whose name contains
# "answer", "svor" or "svör", case-insensitively. Code files (e.g. a DAL module
# answer-key.ts) are allowed; fake test fixtures must be TypeScript, not data files.
# This check is the authoritative one; .gitignore and .dockerignore cover the
# common cases of the same patterns (a subset), so `git add` usually skips the
# file before CI ever sees it.
#
# Usage: scripts/check-no-answer-files.sh            # files in the current tree
#        scripts/check-no-answer-files.sh --history  # every path ever committed
set -eu

# ö/Ö spelled out: grep -i can't case-fold non-ASCII letters in the C locale.
PATTERN='(answer|svor|svör|svÖr)[^/]*\.(json|csv|tsv|ya?ml|txt|xlsx)$'

# core.quotePath=false: otherwise git escapes non-ASCII names ("sv\303\266r")
# and the pattern would never match them.
if [ "${1:-}" = "--history" ]; then
  scope="git history"
  files=$(git -c core.quotePath=false log --all --format= --name-only | sort -u)
else
  scope="current tree"
  files=$(git -c core.quotePath=false ls-files)
fi

found=$(printf '%s\n' "$files" | grep -iE "$PATTERN" || true)

if [ -n "$found" ]; then
  echo "Answer-key data files found in the $scope (this repo is public):"
  printf '%s\n' "$found" | sed 's/^/  /'
  echo "Remove them; answers belong only in Neon (docs/PLAN.md, Phase 5)."
  exit 1
fi

echo "No answer-key data files in the $scope."
