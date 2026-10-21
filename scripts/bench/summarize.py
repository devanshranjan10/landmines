# Summarise bench result files by arm: pass rate, trigger left in final code, hook activity, cost, turns.
# Usage: python3 scripts/bench/summarize.py bench/results/<run>.jsonl [...] [--exclude id,id]
import json, sys, collections
args = [a for a in sys.argv[1:] if not a.startswith('--')]
excl = set()
if '--exclude' in sys.argv: excl = set(sys.argv[sys.argv.index('--exclude') + 1].split(','))
args = [a for a in args if not set(a.split(',')) <= excl]
rows = [json.loads(l) for f in args for l in open(f) if l.strip()]
rows = [r for r in rows if r['task'] not in excl]
by = collections.defaultdict(list)
for r in rows: by[(r.get('model'), r.get('condition', 'exec'), r.get('prompt', 'spec'), r['arm'])].append(r)
for k in sorted(by):
    v = by[k]
    n = len(v)
    print('%-34s n=%-3d pass %2d/%-3d trigger %2d  fired %2d denied %2d  $%.2f  turns %.1f  fails %s' % (
        ' '.join(map(str, k)), n, sum(r['pass'] for r in v), n, sum(r['triggerInFinal'] for r in v),
        sum(1 for r in v if r['hookFired']), sum(1 for r in v if r['hookDenied']),
        sum(r.get('costUsd') or 0 for r in v), sum(r['turns'] for r in v) / n,
        ','.join(sorted(r['task'] for r in v if not r['pass']))))
