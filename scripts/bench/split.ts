// Freeze the dev/test split once, before any tuning (D-36). Whole packages go to one side, so tuning on dev never
// sees a test package. Seeded shuffle; dev gets packages until it holds about a third of the tasks.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH, loadTasks } from './lib.js';

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `--set fresh` freezes bench/split-fresh.json for the post-cutoff tasks; the 2024 split (bench/split.json) is never re-rolled.
const set = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : '2024';
const SEED = 20261021;
const tasks = loadTasks().filter((t) => (t.set ?? '2024') === set);
const byPkg = new Map<string, string[]>();
for (const t of tasks) byPkg.set(t.package, [...(byPkg.get(t.package) ?? []), t.id]);
const pkgs = [...byPkg.keys()].sort();
const rand = mulberry32(SEED);
for (let i = pkgs.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [pkgs[i], pkgs[j]] = [pkgs[j] as string, pkgs[i] as string];
}
const dev: string[] = [];
const test: string[] = [];
for (const p of pkgs) (dev.length < Math.round(tasks.length / 3) ? dev : test).push(...(byPkg.get(p) ?? []));
const out = { seed: SEED, frozenAt: new Date().toISOString(), rule: 'whole packages per side; packages go to dev until it reaches a third of the tasks; the package that crosses the line goes to dev too', dev: dev.sort(), test: test.sort() };
writeFileSync(join(BENCH, set === '2024' ? 'split.json' : `split-${set}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(`dev ${dev.length}: ${dev.join(' ')}\ntest ${test.length}: ${test.join(' ')}`);
