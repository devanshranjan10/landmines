#!/usr/bin/env python3
"""Aggregate showcase scans: per repo, unique open issues across every lockfile dir, the ones the hook arms on,
and the ones with a workaround. Reads run.log (and run2.log, from a second runner) in SHOWCASE_DIR, writes summary.json and
armed.json there, and prints a table. Usage: SHOWCASE_DIR=/tmp/lm-showcase python3 scripts/showcase/aggregate.py"""
import json, glob, os, re, subprocess, collections

LM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'dist', 'cli.js')
os.chdir(os.environ.get('SHOWCASE_DIR', '/tmp/lm-showcase'))
log = open('run.log').read() + '\n' + (open('run2.log').read() if os.path.exists('run2.log') else '')
repos = collections.OrderedDict()
cur = None
for line in log.splitlines():
    m = re.match(r'== (\S+) @ (\w+)', line)
    if m:
        cur = m.group(1); repos.setdefault(cur, {'repo': cur, 'sha': m.group(2), 'dirs': []})
        continue
    m = re.match(r'  (\S+) rc=(\d+) (\d+)s', line)
    if m and cur:
        repos[cur]['dirs'].append({'dir': m.group(1), 'rc': int(m.group(2)), 'secs': int(m.group(3))})

# Folders that don't ship: scratch artifacts, test sandboxes, evals.
SKIP = re.compile(r'(^|/)(artifacts|[\w-]*sandbox|playground|evals?|integration-tests?)(/|$)')
out = []
all_armed = {}
for r, info in repos.items():
    name = r.replace('/', '__')
    issues, armed, work, deps, deps_hit, prod_issues = {}, set(), set(), set(), set(), set()
    lockfiles = []
    armed_detail = {}
    skipped = []
    for dd in info['dirs']:
        x = dd['dir']
        if SKIP.search(x):
            skipped.append(x); continue
        f = f'results/{name}.json' if x == '.' else f"results/{name}__{x.replace('/', '_')}.json"
        if not os.path.exists(f):
            continue
        idx = json.load(open(f))
        lockfiles += [('' if x == '.' else x + '/') + l for l in idx['lockfiles']]
        dev = {(p['ecosystem'], p['name'], p['version']): p.get('dev', False) for p in idx['packages']}
        for p in idx['packages']:
            if p['status'] == 'ok':
                deps.add((p['ecosystem'], p['name'], p['version']))
        for l in idx['landmines']:
            # Same rule as `scan` and `share`: no weak mentions or non-bugs; an issue counts once per repo.
            if (l.get('evidence') or {}).get('strength') == 'weak' or l.get('nonBug'):
                continue
            key = l['id']
            issues[key] = l
            deps_hit.add((l['ecosystem'], l['package'], l['version']))
            if l.get('workaround', {}) and l['workaround'].get('kind') == 'workaround' or (l.get('card') or {}).get('workaround'):
                work.add(key)
            if not dev.get((l['ecosystem'], l['package'], l['version']), False):
                prod_issues.add(key)
        root = f"repos/{name}" + ('' if x == '.' else '/' + x)
        try:
            listed = json.loads(subprocess.run(['node', LM, 'list', '-r', root, '--json'], capture_output=True, text=True).stdout or '[]')
        except Exception:
            listed = []
        for l in (listed if isinstance(listed, list) else listed.get('landmines', [])):
            armed.add(l['id'])
            armed_detail[l['id'] + '@' + l['version']] = (l, dev.get((l['ecosystem'], l['package'], l['version']), False), x)
    for k, (l, isdev, d) in armed_detail.items():
        a = all_armed.setdefault(k, {'key': k, 'ecosystem': l['ecosystem'], 'package': l['package'], 'version': l['version'], 'id': l['id'],
                                     'title': l['issue']['title'], 'url': l['issue']['url'], 'evidence': (l.get('evidence') or {}).get('quote'),
                                     'workaround': (l.get('workaround') or {}).get('kind') == 'workaround', 'repos': [], 'devEverywhere': True})
        a['repos'].append(r); a['devEverywhere'] = a['devEverywhere'] and isdev
    def score(item):
        l, isdev, _ = item
        has_w = 1 if (l.get('workaround') or {}).get('kind') == 'workaround' else 0
        return (not isdev, has_w, (l['issue'].get('reactions') or 0) + (l['issue'].get('comments') or 0))
    ex = sorted(armed_detail.values(), key=score, reverse=True)[:5]
    examples = [{'package': l['package'], 'version': l['version'], 'id': l['id'], 'title': l['issue']['title'], 'url': l['issue']['url'],
                 'dev': isdev, 'dir': d, 'symbols': [s if isinstance(s, str) else s.get('name') for s in l.get('symbols', [])][:4],
                 'workaround': (l.get('workaround') or {}).get('kind') == 'workaround', 'createdAt': l['issue'].get('createdAt'),
                 'evidence': (l.get('evidence') or {}).get('quote')} for l, isdev, d in ex]
    top = collections.Counter(l['package'] + '@' + l['version'] for l in issues.values()).most_common(3)
    out.append({'repo': r, 'sha': info['sha'], 'lockfiles': lockfiles, 'deps': len(deps), 'depsWithIssues': len(deps_hit),
                'issues': len(issues), 'runtimeIssues': len(prod_issues), 'armed': len(armed), 'workarounds': len(work), 'top': top, 'skippedDirs': skipped, 'examples': examples, 'armedIds': sorted(armed)})

json.dump(out, open('summary.json', 'w'), indent=1)
json.dump(sorted(all_armed.values(), key=lambda a: a['key']), open('armed.json', 'w'), indent=1)
for o in out:
    print(f"{o['repo']:38} deps {o['deps']:4}  hit {o['depsWithIssues']:4}  issues {o['issues']:5}  runtime {o['runtimeIssues']:5}  armed {o['armed']:4}  wk {o['workarounds']:4}  top {o['top']}")
