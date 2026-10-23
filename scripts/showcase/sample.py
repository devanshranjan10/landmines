#!/usr/bin/env python3
"""Draw the precision-audit sample: N distinct armed issues, uniformly at random with a fixed seed, from armed.json.
Usage: SHOWCASE_DIR=/tmp/lm-showcase python3 scripts/showcase/sample.py [N] [seed]  -> audit-sample.json"""
import json, os, random, sys

os.chdir(os.environ.get("SHOWCASE_DIR", "/tmp/lm-showcase"))

n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
seed = int(sys.argv[2]) if len(sys.argv) > 2 else 20261023
armed = json.load(open('armed.json'))
by_id = {}
for a in armed:  # one entry per issue: the same issue can be armed at two versions in different repos
    by_id.setdefault(a['id'], a)
ids = sorted(by_id)
pick = random.Random(seed).sample(ids, n)
sample = [{k: by_id[i][k] for k in ('id', 'package', 'version', 'title', 'url', 'evidence', 'workaround', 'repos')} for i in pick]
json.dump({'seed': seed, 'population': len(ids), 'n': n, 'sample': sample}, open('audit-sample.json', 'w'), indent=1)
print(f'{n} of {len(ids)} distinct armed issues, seed {seed}')
