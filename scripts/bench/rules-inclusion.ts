// Would the rules section still list a task's bug in a real project with many dependencies? Merges each fresh task's
// index (with its frozen cards) into a real project's carded index (eval/fresh-a, 46 dependencies; the task's own
// package is removed from it) and reports where the target issue ranks, by card confidence alone and with the seed
// project's usage level. Offline, no agent.
//   npx tsx scripts/bench/rules-inclusion.ts [--noise eval/fresh-a]
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCards } from '../../src/cards.js';
import { DEFAULT_MAX_RULES, SKILL_MAX, rulesLandmines } from '../../src/rules.js';
import { readIndex } from '../../src/store.js';
import type { LandmineIndex } from '../../src/types.js';
import { projectUsage } from '../../src/usage.js';
import { BENCH, ROOT, loadTasks, splitIds } from './lib.js';

const { values } = parseArgs({ options: { noise: { type: 'string', default: 'eval/fresh-a' } } });
const noise = readIndex(join(ROOT, values.noise));
if (!noise) throw new Error(`no index in ${values.noise}`);
const carded = noise.landmines.filter((l) => l.card).length;
console.log(`noise: ${values.noise}, ${noise.packages.length} packages, ${noise.landmines.length} issues (${carded} carded)\n`);

for (const split of ['fresh-dev', 'fresh-test']) {
  const ids = splitIds(split) ?? [];
  let top15 = 0;
  let top60 = 0;
  let level2 = 0;
  const rows: string[] = [];
  for (const task of loadTasks(ids)) {
    const own = readIndex(join(BENCH, '.work', 'cardgen', `${task.ecosystem}/${task.package}@${task.version}`.replace(/[/@]/g, '_')));
    if (!own) throw new Error(`no index for ${task.id}`);
    own.landmines = own.landmines.filter((l) => l.package === task.package && l.version === task.version);
    loadCards(own, join(BENCH, 'fixtures', 'cards'));
    const merged: LandmineIndex = {
      ...own,
      packages: [...own.packages.filter((p) => p.name === task.package), ...noise.packages.filter((p) => p.name !== task.package)],
      landmines: [...own.landmines, ...noise.landmines.filter((l) => l.package !== task.package)],
    };
    const ranked = rulesLandmines(merged, Infinity);
    const rank = ranked.findIndex((l) => l.id === task.issue) + 1;
    // Usage level of the target in the task's seed project (the code the agent starts from).
    const dir = mkdtempSync(join(tmpdir(), 'lmb-incl-'));
    cpSync(join(task.dir, 'project'), dir, { recursive: true });
    const level = projectUsage(dir, own).get(`${task.issue}@${task.version}`) ?? 0;
    rmSync(dir, { recursive: true, force: true });
    if (rank > 0 && rank <= DEFAULT_MAX_RULES) top15++;
    if (rank > 0 && rank <= SKILL_MAX) top60++;
    if (level === 2) level2++;
    rows.push(`  ${task.id.padEnd(22)} rank ${rank ? `${rank}/${ranked.length}` : 'not armed'}  usage ${level}`);
  }
  console.log(`${split}: ${ids.length} tasks`);
  console.log(rows.join('\n'));
  console.log(`  target in top ${DEFAULT_MAX_RULES} by confidence: ${top15}/${ids.length}; in top ${SKILL_MAX} (skill): ${top60}/${ids.length}; seed code already uses the target API (usage 2): ${level2}/${ids.length}\n`);
}
