/**
 * Draw a seeded random sample of armed landmines (the ones the hook can fire on) from a
 * scanned project, with the issue text needed to label them by hand.
 *
 *   npx tsx scripts/accuracy-sample.ts eval/heldout 40 20261021 > eval/heldout/sample.json
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawIssue } from '../src/github/issues.js';
import { armedSymbols, isArmed } from '../src/policy.js';
import { cacheFile } from '../src/scan.js';
import { readIndex } from '../src/store.js';

const [rootArg, nArg, seedArg] = process.argv.slice(2);
const root = rootArg ?? 'eval/heldout';
const n = Number(nArg ?? 40);
let seed = Number(seedArg ?? 20261021);
const rand = (): number => {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const index = readIndex(root);
if (!index) throw new Error(`no index in ${root}`);
const seen = new Set<string>();
const armed = index.landmines.filter((l) => isArmed(l) && !seen.has(l.id) && seen.add(l.id));
const pool = [...armed];
const picked = [];
while (picked.length < n && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);

const raw = (pkg: string, version: string, ecosystem: 'npm' | 'pypi'): RawIssue[] => {
  try {
    return (JSON.parse(readFileSync(cacheFile(join(process.cwd(), root), { ecosystem, name: pkg, version }), 'utf8')) as { issues: RawIssue[] }).issues;
  } catch {
    return [];
  }
};

const out = picked.map((l, i) => {
  const issue = raw(l.package, l.version, l.ecosystem).find((r) => r.number === l.issue.number);
  return {
    n: i + 1,
    id: l.id,
    package: `${l.package}@${l.version}`,
    title: l.issue.title,
    url: l.issue.url,
    labels: l.issue.labels,
    evidence: l.evidence,
    armedSymbols: armedSymbols(l).slice(0, 4),
    workaround: l.workaround ? { kind: l.workaround.kind, author: l.workaround.author, excerpt: l.workaround.excerpt.slice(0, 500) } : null,
    body: (issue?.body ?? '').replace(/<!--[\s\S]*?-->/g, '').slice(0, 1200),
  };
});
process.stdout.write(`${JSON.stringify({ root, armedTotal: armed.length, sampled: out.length, seed: Number(seedArg ?? 20261021), items: out }, null, 2)}\n`);
