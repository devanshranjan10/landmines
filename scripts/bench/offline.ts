// Offline trap track: would the hook fire when the agent writes the naive (buggy) solution, and stay quiet when it
// writes the workaround? Deterministic, no agent, no network. Simulates the agent's Write of each reference file.
// Usage: npx tsx scripts/bench/offline.ts [--arm hook|cards] [--split dev|test|all] [--out file]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runHook } from '../../src/hook/run.js';
import { type Task, loadTasks, materialize, splitIds } from './lib.js';
import { type Arm, prepareArm } from './prepare.js';

const { values } = parseArgs({
  options: {
    arm: { type: 'string', default: 'hook' },
    split: { type: 'string', default: 'all' },
    out: { type: 'string' },
    'heads-up': { type: 'boolean', default: false },
  },
});


interface Probe {
  decision: string;
  ids: string[];
  target: boolean;
}

function probe(task: Task, dir: string, which: 'naive' | 'fixed'): Probe[] {
  return task.entry.map((f) => {
    const content = readFileSync(join(task.dir, 'reference', which, f), 'utf8');
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: `offline-${task.id}-${which}`,
      cwd: dir,
      tool_name: 'Write',
      tool_input: { file_path: join(dir, f), content },
    };
    const stateDir = mkdtempSync(join(tmpdir(), 'lmb-state-'));
    const r = runHook(JSON.stringify(payload), { harness: 'claude', stateDir, headsUp: values['heads-up'], env: {} });
    rmSync(stateDir, { recursive: true, force: true });
    const hitIds = r.hits.map((h) => h.id);
    return { decision: r.decision, ids: hitIds, target: r.decision !== 'none' && hitIds.includes(task.issue) };
  });
}

const arm = values.arm as Arm;
const rows = [];
for (const task of loadTasks(splitIds(values.split))) {
  const dir = materialize(task);
  prepareArm(task, dir, arm);
  const naive = probe(task, dir, 'naive');
  const fixed = probe(task, dir, 'fixed');
  rmSync(dir, { recursive: true, force: true });
  const row = {
    task: task.id,
    issue: task.issue,
    naiveDecision: naive.some((p) => p.decision === 'deny') ? 'deny' : naive.some((p) => p.decision === 'context') ? 'context' : 'none',
    naiveTarget: naive.some((p) => p.target),
    naiveIds: [...new Set(naive.flatMap((p) => p.ids))],
    fixedDecision: fixed.some((p) => p.decision === 'deny') ? 'deny' : fixed.some((p) => p.decision === 'context') ? 'context' : 'none',
    fixedTarget: fixed.some((p) => p.target),
    fixedIds: [...new Set(fixed.flatMap((p) => p.ids))],
  };
  rows.push(row);
  console.log(
    `${row.task.padEnd(22)} naive=${row.naiveDecision.padEnd(7)} target=${row.naiveTarget ? 'Y' : '-'}  fixed=${row.fixedDecision.padEnd(7)} target=${row.fixedTarget ? 'Y' : '-'}  ${row.naiveIds.join(' ')}`,
  );
}
const n = rows.length;
const caught = rows.filter((r) => r.naiveDecision === 'deny' && r.naiveTarget).length;
const anyNaive = rows.filter((r) => r.naiveDecision === 'deny').length;
const fixedFires = rows.filter((r) => r.fixedDecision === 'deny').length;
const fixedTarget = rows.filter((r) => r.fixedDecision === 'deny' && r.fixedTarget).length;
const summary = { arm, split: values.split, tasks: n, naiveBlockedOnTarget: caught, naiveBlockedAny: anyNaive, fixedBlockedAny: fixedFires, fixedBlockedOnTarget: fixedTarget };
console.log(JSON.stringify(summary));
if (values.out) writeFileSync(values.out, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
