#!/usr/bin/env bash
# Print the Homebrew formula for the landmines version published on npm (default: package.json's version).
#   scripts/release/brew-formula.sh [version] > ../homebrew-tap/Formula/landmines.rb
# The formula installs the npm tarball with Homebrew's Node, so `brew install devanshranjan10/tap/landmines` gives
# `landmine` and `landmines` on PATH.
set -euo pipefail
cd "$(dirname "$0")/../.."
version="${1:-$(node -p "require('./package.json').version")}"
url="https://registry.npmjs.org/landmines/-/landmines-${version}.tgz"
sha="$(curl -fsSL "$url" | shasum -a 256 | cut -d' ' -f1)"
cat <<RUBY
class Landmines < Formula
  desc "Known open bugs in your pinned dependency versions, for coding agents"
  homepage "https://github.com/devanshranjan10/landmines"
  url "${url}"
  sha256 "${sha}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/landmine --version")
    (testpath/"package-lock.json").write <<~JSON
      {"name":"t","version":"1.0.0","lockfileVersion":3,"packages":{"":{"dependencies":{"zod":"3.23.8"}},"node_modules/zod":{"version":"3.23.8"}}}
    JSON
    system bin/"landmine", "scan", "--offline", "-q"
  end
end
RUBY
