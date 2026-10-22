#!/bin/sh
# Tells IndexNow search engines (Bing, Yandex, Seznam, Naver; Bing feeds ChatGPT search and Copilot) that
# landmine.tech changed. Run after `npm run site:deploy`. The key file is site/<key>.txt.
set -e
cd "$(dirname "$0")/../.."
KEY=$(basename "$(ls site/*.txt | grep -E '/[0-9a-f]{32}\.txt$' | head -1)" .txt)
URLS='"https://landmine.tech/","https://landmine.tech/docs/","https://landmine.tech/benchmark/","https://landmine.tech/faq/","https://landmine.tech/llms.txt","https://landmine.tech/llms-full.txt"'
curl -s -o /dev/null -w 'IndexNow: HTTP %{http_code}\n' -X POST https://api.indexnow.org/indexnow \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"landmine.tech\",\"key\":\"$KEY\",\"keyLocation\":\"https://landmine.tech/$KEY.txt\",\"urlList\":[$URLS]}"
