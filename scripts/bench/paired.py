# Paired comparison of two arms on the same (task, seed, run): wins, losses, exact two-sided McNemar p.
# Usage: python3 scripts/bench/paired.py armA armB file.jsonl [...]
import json, sys
from math import comb
a, b, files = sys.argv[1], sys.argv[2], sys.argv[3:]
res = {}
for f in files:
    for l in open(f):
        r = json.loads(l)
        # Pair on the configuration, not the file, so arms from separate runs of the same setup line up.
        cfg = (r.get('model'), r.get('condition', 'exec'), r.get('prompt', 'spec'))
        res[(cfg, r['task'], r['seed'], r['arm'])] = r['pass']
keys = {(c, t, s) for (c, t, s, arm) in res}
wins = losses = both = neither = 0
for k in keys:
    if (*k, a) not in res or (*k, b) not in res: continue
    x, y = res[(*k, a)], res[(*k, b)]
    if x and not y: wins += 1
    elif y and not x: losses += 1
    elif x: both += 1
    else: neither += 1
n = wins + losses
p = min(1.0, 2 * sum(comb(n, i) for i in range(0, min(wins, losses) + 1)) / 2 ** n) if n else 1.0
print(f'{a} vs {b}: {a} wins {wins}, loses {losses}, ties {both + neither} (both pass {both}, both fail {neither}); exact McNemar p = {p:.4f}')
