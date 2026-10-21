#!/usr/bin/env bash
# Build everything landmine-bench needs to grade tasks, from pinned files only:
#   - three Python 3.12 environments (bench/.venv, bench/.venv-fresh-a, bench/.venv-fresh-b) from bench/env/requirements-*.txt
#   - node_modules for every npm task project, from its package-lock.json (npm ci, no install scripts)
# Needs: Node >= 22.12, uv (https://docs.astral.sh/uv/), network access to PyPI and npm. About 1.7 GB on disk.
#   bench/setup.sh            # everything
#   bench/setup.sh --npm      # npm task projects only
#   bench/setup.sh --python   # Python environments only
set -euo pipefail
BENCH="$(cd "$(dirname "$0")" && pwd)"
want_npm=1
want_py=1
[ "${1:-}" = "--npm" ] && want_py=0
[ "${1:-}" = "--python" ] && want_npm=0

if [ "$want_py" = 1 ]; then
  command -v uv >/dev/null || { echo "uv is required: https://docs.astral.sh/uv/getting-started/installation/" >&2; exit 1; }
  for pair in ".venv:requirements-2024.txt" ".venv-fresh-a:requirements-fresh-a.txt" ".venv-fresh-b:requirements-fresh-b.txt"; do
    venv="${pair%%:*}"
    reqs="${pair##*:}"
    echo "== $venv from env/$reqs"
    uv venv --quiet --python 3.12 --allow-existing "$BENCH/$venv"
    uv pip install --quiet --python "$BENCH/$venv/bin/python" -r "$BENCH/env/$reqs"
  done
fi

if [ "$want_npm" = 1 ]; then
  for pkg in "$BENCH"/tasks/*/project/package.json; do
    dir="$(dirname "$pkg")"
    echo "== npm ci $(basename "$(dirname "$dir")")"
    (cd "$dir" && npm ci --ignore-scripts --no-audit --no-fund --silent)
  done
fi
echo "landmine-bench environments ready. Check them with: npx tsx scripts/bench/validate.ts"
