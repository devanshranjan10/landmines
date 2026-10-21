// Validate every bench task fail→pass: the naive reference must fail the hidden test, the fixed one must pass,
// the untouched seed must fail, and the trigger regex must match naive but not fixed.
// Usage: npx tsx scripts/bench/validate.ts [task-id ...]
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH, applyReference, loadTasks, materialize, runHidden, triggerPresent } from './lib.js';

const tasks = loadTasks(process.argv.slice(2));
const results: Array<Record<string, unknown>> = [];
let bad = 0;
for (const task of tasks) {
  const row: Record<string, unknown> = { id: task.id };
  try {
    const seed = materialize(task);
    row.seedFails = !runHidden(task, seed).pass;
    rmSync(seed, { recursive: true, force: true });
    for (const which of ['naive', 'fixed'] as const) {
      const dir = materialize(task);
      applyReference(task, dir, which);
      const r = runHidden(task, dir);
      row[`${which}Pass`] = r.pass;
      row[`${which}Trigger`] = triggerPresent(task, dir);
      if ((which === 'naive') === r.pass) row[`${which}Output`] = r.output.slice(-600);
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    row.error = (err as Error).message;
  }
  row.ok = row.seedFails === true && row.naivePass === false && row.fixedPass === true && row.naiveTrigger === true && row.fixedTrigger === false;
  if (!row.ok) bad++;
  results.push(row);
  console.log(`${row.ok ? 'ok  ' : 'BAD '} ${task.id}${row.ok ? '' : ` ${JSON.stringify(row)}`}`);
}
if (process.argv.length <= 2) writeFileSync(join(BENCH, 'validation.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(`${tasks.length - bad}/${tasks.length} tasks valid`);
process.exit(bad ? 1 : 0);
