#!/bin/bash
# Scans public repos for docs/showcase. For each repo: a blobless sparse clone (lockfiles and manifests only), then
# `landmine scan` in every directory with a lockfile, saving the index and the `share` line under results/.
# Usage: SHOWCASE_DIR=/tmp/lm-showcase scripts/showcase/run.sh owner/repo ... > run.log
# Needs `npm run build` and `gh auth login`. Then: aggregate.py, sample.py (run them in SHOWCASE_DIR).
set -u
export GITHUB_TOKEN=$(gh auth token)
LM="$(cd "$(dirname "$0")/../.." && pwd)/dist/cli.js"
mkdir -p "${SHOWCASE_DIR:=/tmp/lm-showcase}" && cd "$SHOWCASE_DIR"
mkdir -p repos results
for r in "$@"; do
  name=${r//\//__}
  d=repos/$name
  if [ ! -d "$d" ]; then
    git clone -q --depth 1 --filter=blob:none --sparse "https://github.com/$r.git" "$d" || { echo "CLONE FAIL $r"; continue; }
  fi
  sha=$(git -C "$d" rev-parse HEAD)
  # Lockfiles at most 3 directories deep, skipping tests/fixtures/examples/docs.
  files=$(git -C "$d" ls-tree -r HEAD --name-only | grep -E '(^|/)(pnpm-lock\.yaml|yarn\.lock|bun\.lock|package-lock\.json|npm-shrinkwrap\.json|uv\.lock|poetry\.lock|Pipfile\.lock|requirements[^/]*\.txt)$' \
    | grep -vE '(^|/)(test|tests|__tests__|fixtures?|examples?|docs?|dev-docs|e2e|benchmarks?|third_party|vendor|node_modules|templates?|cookbook|samples?)/' \
    | awk -F/ 'NF<=4')
  # Directories holding them; "." is the repo root.
  dirs=$(echo "$files" | awk -F/ '{ if (NF==1) print "."; else { NF--; print } }' OFS=/ | sort -u)
  pats=""
  for x in $dirs; do
    if [ "$x" = "." ]; then pats="$pats /package.json /pyproject.toml"; else pats="$pats $x/package.json $x/pyproject.toml"; fi
  done
  git -C "$d" sparse-checkout set --no-cone $files $pats 'package.json' 'pyproject.toml' 'pnpm-workspace.yaml' '!node_modules/' >/dev/null 2>&1
  echo "== $r @ $sha"
  for x in $dirs; do
    if [ "$x" = "." ]; then root="$d"; out="results/$name"; else root="$d/$x"; out="results/${name}__${x//\//_}"; fi
    if [ -f "$out.json" ]; then echo "  skip $x (done)"; continue; fi
    start=$(date +%s)
    node $LM scan -r "$root" -q >"$out.scan.log" 2>&1
    rc=$?
    cp "$root/.landmine/index.json" "$out.json" 2>/dev/null
    node $LM share -r "$root" >"$out.share.txt" 2>&1
    echo "  $x rc=$rc $(( $(date +%s)-start ))s :: $(head -1 "$out.share.txt")"
  done
done
