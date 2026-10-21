// Write the frozen trigger cards the `cards` arm uses: for every package version a task pins, rebuild the index from
// the frozen raw issues, card every candidate issue once (cached under bench/.work/cardgen), and export the cards to
// bench/fixtures/cards. The model never sees the task, only the issue thread, exactly as `landmine cards` would.
// Usage: env -u CLAUDE_CONFIG_DIR npx tsx scripts/bench/gen-cards.ts [--split all] [--provider claude-cli] [--model opus] [--dry-run]
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { addCards, cardCandidates, exportCards } from '../../src/cards.js';
import { PROVIDERS, type ProviderName, provider } from '../../src/llm.js';
import { readIndex } from '../../src/store.js';
import { BENCH, loadTasks, splitIds } from './lib.js';
import { cli } from './prepare.js';

const { values } = parseArgs({
  options: {
    split: { type: 'string', default: 'all' },
    provider: { type: 'string', default: 'claude-cli' },
    model: { type: 'string' },
    concurrency: { type: 'string', default: '6' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!PROVIDERS.includes(values.provider as ProviderName)) throw new Error(`unknown provider ${values.provider}`);

const OUT = join(BENCH, 'fixtures', 'cards');
const seen = new Set<string>();
let total = 0;
const llm = values['dry-run'] ? undefined : await provider(values.provider as ProviderName, values.model ? { model: values.model } : {});
for (const task of loadTasks(splitIds(values.split))) {
  const key = `${task.ecosystem}/${task.package}@${task.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const root = join(BENCH, '.work', 'cardgen', key.replace(/[/@]/g, '_'));
  const file = `${encodeURIComponent(task.package)}@${encodeURIComponent(task.version)}.json`;
  mkdirSync(join(root, '.landmine', 'cache', task.ecosystem), { recursive: true });
  cpSync(join(task.dir, 'project'), root, { recursive: true });
  cpSync(join(BENCH, 'fixtures', 'cache', task.ecosystem, file), join(root, '.landmine', 'cache', task.ecosystem, file));
  cli(['scan', '--offline', '-q', '-r', root], root);
  const index = readIndex(root);
  if (!index) throw new Error(`no index for ${key}`);
  // Only the task's own package: other pins have no frozen data.
  index.landmines = index.landmines.filter((l) => l.package === task.package && l.version === task.version);
  const n = cardCandidates(index).length;
  total += n;
  console.log(`${key}: ${n} candidate issue${n === 1 ? '' : 's'}`);
  if (!llm) continue;
  const run = await addCards(root, index, llm, { concurrency: Number(values.concurrency), log: (m) => console.log(m) });
  console.log(`  generated ${run.generated}, cached ${run.cached}, failed ${run.failed.length}, unusable ${run.rejected.length}, no raw text ${run.noRawText}`);
  exportCards(index, OUT);
}
console.log(`${seen.size} package versions, ${total} candidate issues${llm ? `; cards in ${OUT}` : ''}`);
if (llm) {
  const meta = { provider: llm.name, model: llm.model, generatedAt: new Date().toISOString(), split: values.split };
  const metaFile = join(OUT, '_meta.json');
  let prev: unknown[] = [];
  try {
    prev = JSON.parse(readFileSync(metaFile, 'utf8')) as unknown[];
  } catch {
    // first run
  }
  writeFileSync(metaFile, `${JSON.stringify([...prev, meta], null, 2)}\n`);
}
