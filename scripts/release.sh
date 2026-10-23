#!/bin/sh
# Release the version in package.json from this machine: npm, the tag (whose workflow lists it in the MCP Registry),
# a GitHub release (which publishes to GitHub Packages) and the Homebrew tap. Each step is skipped if it is already done.
# Needs: `npm login` (npm), `gh auth login` (everything else), a clean main that is pushed.
# Usage: sh scripts/release.sh
set -eu
cd "$(dirname "$0")/.."
v=$(node -p "require('./package.json').version")
echo "releasing landmines $v"

test -z "$(git status --porcelain)" || { echo "commit or stash your changes first"; exit 1; }
git fetch -q origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" || { echo "push main first (HEAD is not origin/main)"; exit 1; }

# 1. npm
if npm view "landmines@$v" version >/dev/null 2>&1; then
  echo "npm: landmines@$v already published"
else
  npm whoami >/dev/null 2>&1 || { echo "npm: not logged in; run: npm login"; exit 1; }
  npm publish --access public
fi

# 2. tag: the release workflow sees the version on npm, skips publishing, and lists it in the MCP Registry
if git ls-remote --exit-code --tags origin "v$v" >/dev/null 2>&1; then
  echo "tag v$v already pushed"
else
  git tag -a "v$v" -m "landmines $v"
  git push origin "v$v"
fi

# 3. GitHub release, with this version's CHANGELOG section as notes
if gh release view "v$v" >/dev/null 2>&1; then
  echo "GitHub release v$v exists"
else
  awk -v v="$v" '$0 ~ "^## "v" " {on=1; next} /^## / {on=0} on' CHANGELOG.md > /tmp/landmines-notes.md
  gh release create "v$v" --title "landmines $v" --notes-file /tmp/landmines-notes.md
fi

# 4. GitHub Packages (@devanshranjan10/landmines): publishing the release above triggers github-packages.yml

# 5. Homebrew tap: point the formula at the new npm tarball
tgz="https://registry.npmjs.org/landmines/-/landmines-$v.tgz"
sha=$(curl -fsSL "$tgz" | shasum -a 256 | cut -d' ' -f1)
tap=$(mktemp -d)
gh repo clone devanshranjan10/homebrew-tap "$tap" -- -q
f="$tap/Formula/landmines.rb"
if grep -q "landmines-$v.tgz" "$f"; then
  echo "Homebrew: already at $v"
else
  sed -i.bak -e "s#^  url .*#  url \"$tgz\"#" -e "s#^  sha256 .*#  sha256 \"$sha\"#" "$f" && rm "$f.bak"
  # commit as this repo's identity: a fresh clone uses the global one, and GitHub rejects pushes with a private email
  git -C "$tap" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit -qam "landmines $v"
  git -C "$tap" push -q && echo "Homebrew: tap updated to $v"
fi
rm -rf "$tap"

echo "done. Watch the MCP Registry step: gh run list -w release -L 1"
