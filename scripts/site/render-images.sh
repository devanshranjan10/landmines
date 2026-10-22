#!/bin/sh
# Renders site/og.png and the PNG favicons with headless Chrome. Needs Chrome or chrome-headless-shell.
set -e
cd "$(dirname "$0")/../.."
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
shot() { "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
  --virtual-time-budget=3000 --window-size="$2" --screenshot="$3" "file://$PWD/$1" >/dev/null 2>&1; }
shot scripts/site/og.html 1200,630 site/og.png
shot site/favicon.svg 32,32 site/favicon-32.png
shot site/favicon.svg 180,180 site/apple-touch-icon.png
ls -la site/og.png site/favicon-32.png site/apple-touch-icon.png
