// landmine-bench trap runner: one headless agent session per (task, arm, seed), graded by the hidden test.
// Usage: npx tsx scripts/bench/run.ts --arm none,hook --split dev [--tasks a,b] [--seeds 1] [--model sonnet]
//          [--agent claude|codex] [--concurrency 3] [--run-id name] [--dry]
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH, type Task, loadTasks, materialize, prompt, runHidden, triggerPresent, splitIds } from './lib.js';
import { ARMS, type Arm, prepareArm } from './prepare.js';

const { values } = parseArgs({
  options: {
    arm: { type: 'string', default: 'none' },
    split: { type: 'string', default: 'dev' },
    tasks: { type: 'string' },
    seeds: { type: 'string', default: '1' },
    'seed-start': { type: 'string', default: '1' },
    model: { type: 'string', default: 'sonnet' },
    agent: { type: 'string', default: 'claude' },
    concurrency: { type: 'string', default: '3' },
    'max-turns': { type: 'string', default: '40' },
    'run-id': { type: 'string' },
    // Empty: unset CLAUDE_CONFIG_DIR so the CLI uses its default login (keeps bench runs off this session's account).
    'config-dir': { type: 'string', default: '' },
    dry: { type: 'boolean', default: false },
    // exec: the agent may run shell commands (default). edit-only: Read/Edit/Write/Glob/Grep only, no Bash.
    condition: { type: 'string', default: 'exec' },
  },
});

const runId = values['run-id'] ?? `${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '')}-${values.agent}-${values.model}`;
const WORK = join(BENCH, '.work', runId);
// Agents work outside the repo, so nothing above their directory (hidden tests, references, git) is visible.
const SANDBOX = join(tmpdir(), 'lmb-runs', runId);
mkdirSync(SANDBOX, { recursive: true });
const RESULTS = join(BENCH, 'results', `${runId}.jsonl`);
mkdirSync(WORK, { recursive: true });
mkdirSync(join(BENCH, 'results'), { recursive: true });


interface AgentOutcome {
  exitCode: number | null;
  costUsd?: number;
  turns?: number;
  durationMs: number;
  resultText?: string;
  transcript: string;
  timedOut: boolean;
}

function runClaude(task: Task, dir: string, arm: Arm, transcript: string, hookLog: string): Promise<AgentOutcome> {
  const args = [
    '-p',
    prompt(task),
    '--model',
    values.model,
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--disallowedTools',
    values.condition === 'edit-only' ? 'WebSearch,WebFetch,Bash,BashOutput,KillShell,Task' : 'WebSearch,WebFetch',
    '--max-turns',
    values['max-turns'],
    '--no-session-persistence',
  ];
  if (arm === 'mcp') args.push('--mcp-config', join(dir, '.mcp.json'));
  const env: NodeJS.ProcessEnv = { ...process.env, LANDMINE_DEBUG_LOG: hookLog };
  if (values['config-dir']) env.CLAUDE_CONFIG_DIR = values['config-dir'];
  else delete env.CLAUDE_CONFIG_DIR;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 20 * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      writeFileSync(transcript, out + (err ? `\n#stderr\n${err}` : ''));
      let last: Record<string, unknown> | undefined;
      for (const line of out.split('\n')) {
        try {
          const ev = JSON.parse(line) as Record<string, unknown>;
          if (ev.type === 'result') last = ev;
        } catch {
          // not JSON
        }
      }
      resolve({
        exitCode: code,
        costUsd: typeof last?.total_cost_usd === 'number' ? last.total_cost_usd : undefined,
        turns: typeof last?.num_turns === 'number' ? last.num_turns : undefined,
        durationMs: Date.now() - started,
        resultText: typeof last?.result === 'string' ? last.result : undefined,
        transcript: out,
        timedOut,
      });
    });
  });
}

function hookEvents(path: string): Array<{ decision: string; hits: Array<{ id: string }> }> {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { decision: string; hits: Array<{ id: string }> });
}

async function runOne(task: Task, arm: Arm, seed: number): Promise<Record<string, unknown>> {
  const key = `${task.id}.${arm}.s${seed}`;
  const base = join(WORK, key);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const sandbox = join(SANDBOX, key);
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });
  const dir = materialize(task, sandbox);
  prepareArm(task, dir, arm);
  const hookLog = join(base, 'hook.jsonl');
  const transcript = join(base, 'transcript.jsonl');
  const outcome = await runClaude(task, dir, arm, transcript, hookLog);
  const hidden = runHidden(task, dir);
  const events = hookEvents(hookLog);
  const issueNo = task.issue.split('#')[1] ?? '';
  const fired = events.filter((e) => e.decision !== 'none');
  const record = {
    runId,
    task: task.id,
    tier: task.tier,
    arm,
    seed,
    agent: values.agent,
    model: values.model,
    condition: values.condition,
    pass: hidden.pass,
    triggerInFinal: triggerPresent(task, dir),
    hookFired: fired.length,
    hookDenied: fired.filter((e) => e.decision === 'deny').length,
    hookCitedTarget: fired.some((e) => e.hits.some((h) => h.id === task.issue)),
    hookIds: [...new Set(fired.flatMap((e) => e.hits.map((h) => h.id)))],
    agentMentionedIssue: new RegExp(`#${issueNo}\\b|issues/${issueNo}\\b`).test(outcome.transcript),
    costUsd: outcome.costUsd,
    turns: outcome.turns,
    durationMs: outcome.durationMs,
    agentExit: outcome.exitCode,
    timedOut: outcome.timedOut,
    hiddenOutput: hidden.pass ? undefined : hidden.output.slice(-800),
    finishedAt: new Date().toISOString(),
  };
  // Keep the agent's final code for inspection, then drop the sandbox.
  for (const f of task.entry) {
    const p = join(dir, f);
    if (existsSync(p)) cpSync(p, join(base, 'final', f));
  }
  rmSync(sandbox, { recursive: true, force: true });
  appendFileSync(RESULTS, `${JSON.stringify(record)}\n`);
  return record;
}

async function main(): Promise<void> {
  const arms = values.arm.split(',') as Arm[];
  for (const a of arms) if (!ARMS.includes(a)) throw new Error(`unknown arm ${a}`);
  const ids = values.tasks ? values.tasks.split(',') : splitIds(values.split);
  const tasks = loadTasks(ids);
  const seeds = Number(values.seeds);
  const seedStart = Number(values['seed-start']);
  const jobs: Array<{ task: Task; arm: Arm; seed: number }> = [];
  for (let s = seedStart; s < seedStart + seeds; s++) for (const task of tasks) for (const arm of arms) jobs.push({ task, arm, seed: s });
  console.log(`${runId}: ${jobs.length} runs (${tasks.length} tasks × ${arms.join(',')} × ${seeds} seeds) → ${RESULTS}`);
  if (values.dry) {
    for (const j of jobs) {
      const dir = materialize(j.task, WORK);
      prepareArm(j.task, dir, j.arm);
      console.log(`prepared ${j.task.id} ${j.arm} in ${dir}`);
    }
    return;
  }
  let next = 0;
  let cost = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const j = jobs[next++];
      if (!j) break;
      try {
        const r = await runOne(j.task, j.arm, j.seed);
        cost += Number(r.costUsd ?? 0);
        console.log(`${r.pass ? 'PASS' : 'fail'} ${j.task.id} ${j.arm} s${j.seed} fired=${String(r.hookFired)} cited=${String(r.agentMentionedIssue)} $${Number(r.costUsd ?? 0).toFixed(3)} turns=${String(r.turns)} total=$${cost.toFixed(2)}`);
      } catch (err) {
        console.log(`ERROR ${j.task.id} ${j.arm} s${j.seed}: ${(err as Error).message}`);
        appendFileSync(RESULTS, `${JSON.stringify({ runId, task: j.task.id, arm: j.arm, seed: j.seed, error: (err as Error).message })}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  console.log(`done: total $${cost.toFixed(2)}`);
}

await main();
