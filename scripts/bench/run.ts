// landmine-bench trap runner: one headless agent session per (task, arm, seed), graded by the hidden test.
// Usage: npx tsx scripts/bench/run.ts --arm none,hook --split dev [--tasks a,b] [--seeds 1] [--model sonnet]
//          [--agent claude|codex] [--concurrency 3] [--run-id name] [--dry]
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    // spec: prompt.txt (edge cases stated); terse: prompt-terse.txt (how a user would ask).
    prompt: { type: 'string', default: 'spec' },
    // Any agent: --agent cmd --agent-cmd 'my-agent --cwd {dir} --prompt-file {prompt_file}'. Placeholders: {dir} (the
    // working copy), {prompt_file} (the prompt, in a file outside the working copy), {prompt} (shell-quoted),
    // {model}, and {task_dir} (the task's own directory: for harness self-tests only, never give it to a real agent).
    'agent-cmd': { type: 'string' },
    // Any tool under test: --arm custom --setup-cmd 'npx my-tool init' runs in the working copy before the agent starts.
    'setup-cmd': { type: 'string' },
    // Name recorded for a custom agent or arm (e.g. "aider+my-tool"), so leaderboard rows are self-describing.
    label: { type: 'string' },
  },
});

// Codex defaults to the model in the user's Codex config (gpt-5.6-terra); `--model` overrides it.
const MODEL = values.agent === 'codex' && values.model === 'sonnet' ? 'gpt-5.6-terra' : values.model;
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
  /** Codex: total input + output tokens. */
  tokens?: number;
}

function runClaude(task: Task, dir: string, arm: Arm, transcript: string, hookLog: string): Promise<AgentOutcome> {
  const args = [
    '-p',
    prompt(task, values.prompt === 'terse' ? 'terse' : 'spec'),
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
    '--max-turns',
    values['max-turns'],
    '--no-session-persistence',
  ];
  // The `web` arm is the "let the agent look it up" baseline: web search and fetch stay on. Every other arm has them off.
  const blocked = [...(arm === 'web' ? [] : ['WebSearch', 'WebFetch']), ...(values.condition === 'edit-only' ? ['Bash', 'BashOutput', 'KillShell', 'Task'] : [])];
  if (blocked.length) args.push('--disallowedTools', blocked.join(','));
  if (arm === 'mcp' || arm === 'context7') args.push('--mcp-config', join(dir, '.mcp.json'));
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

/**
 * Codex CLI (`codex exec`), logged in with ChatGPT, so there is no per-run dollar cost; tokens are recorded instead.
 * workspace-write sandbox: commands run, network is off. User config and the user's own skills are kept out. Codex reads AGENTS.md, so the rules arm writes there (prepare.ts).
 */
function runCodex(task: Task, dir: string, transcript: string, hookLog: string): Promise<AgentOutcome> {
  const args = [
    'exec',
    '--json',
    '-C',
    dir,
    '--skip-git-repo-check',
    '-s',
    'workspace-write',
    '--ephemeral',
    '--ignore-user-config',
    '--dangerously-bypass-hook-trust',
    '-m',
    MODEL,
    '-c',
    'model_reasoning_effort="medium"',
    prompt(task, values.prompt === 'terse' ? 'terse' : 'spec'),
  ];
  // An empty HOME keeps the user's own skills (~/.agents/skills) out of the run; CODEX_HOME still points at the real
  // ~/.codex, so the login is used in place and never copied.
  const home = join(SANDBOX, '.home');
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, LANDMINE_DEBUG_LOG: hookLog, HOME: home, CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex') };
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('codex', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      let steps = 0;
      let tokens = 0;
      let failed = false;
      let lastMessage: string | undefined;
      for (const line of out.split('\n')) {
        try {
          const ev = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; usage?: { input_tokens?: number; output_tokens?: number } };
          if (ev.type === 'item.completed' && ev.item?.type !== 'agent_message' && ev.item?.type !== 'reasoning') steps++;
          if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') lastMessage = ev.item.text;
          if (ev.type === 'turn.completed') tokens += (ev.usage?.input_tokens ?? 0) + (ev.usage?.output_tokens ?? 0);
          if (ev.type === 'turn.failed' || ev.type === 'error') failed = true;
        } catch {
          // not JSON
        }
      }
      resolve({
        exitCode: failed && code === 0 ? 1 : code,
        turns: steps,
        durationMs: Date.now() - started,
        ...(lastMessage ? { resultText: lastMessage } : {}),
        transcript: out,
        timedOut,
        tokens,
      });
    });
  });
}

/** The session failed before the agent worked on the task: no cost or tokens at all, or an error result. */
function agentErrored(o: AgentOutcome): boolean {
  if (o.timedOut) return false;
  if (values.agent === 'codex') return !o.tokens;
  if (values.agent === 'cmd') return false; // a generic agent's exit code is its own business, not an infra failure
  return !o.costUsd || /hit your (session|usage) limit|rate limit|overloaded|API Error/i.test(o.resultText ?? '');
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(dir|prompt_file|prompt|model|task_dir)\}/g, (_, k: string) => (k === 'prompt' ? shellQuote(vars[k] ?? '') : (vars[k] ?? '')));
}

/** Run a shell command in the working copy and wait for it (setup commands and generic agents). */
function runShell(command: string, dir: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; out: string; timedOut: boolean; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('sh', ['-c', command], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut, ms: Date.now() - started });
    });
  });
}

/** A generic agent: any command line, given the working copy and the prompt (see --agent-cmd). */
async function runCmd(task: Task, dir: string, transcript: string, hookLog: string): Promise<AgentOutcome> {
  const template = values['agent-cmd'];
  if (!template) throw new Error('--agent cmd needs --agent-cmd');
  const text = prompt(task, values.prompt === 'terse' ? 'terse' : 'spec');
  const promptFile = join(dirname(transcript), 'prompt.txt');
  writeFileSync(promptFile, text);
  const command = fill(template, { dir, prompt_file: promptFile, prompt: text, model: values.model, task_dir: task.dir });
  const r = await runShell(command, dir, { ...process.env, LANDMINE_DEBUG_LOG: hookLog }, 20 * 60_000);
  writeFileSync(transcript, r.out);
  return { exitCode: r.code, durationMs: r.ms, transcript: r.out, timedOut: r.timedOut };
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
  const hookLog = join(base, 'hook.jsonl');
  const transcript = join(base, 'transcript.jsonl');
  // An agent session that never reached the model (rate or usage limit, API error) says nothing about the task:
  // start it again from a fresh copy, with backoff, and if it still fails mark it so analysis can drop it.
  let dir = '';
  let outcome: AgentOutcome | undefined;
  let attempts = 0;
  for (; attempts < 4; attempts++) {
    if (attempts > 0) {
      console.log(`RETRY ${key} (attempt ${attempts + 1}): the agent session errored before doing the task`);
      await new Promise((r) => setTimeout(r, attempts * 120_000));
    }
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(hookLog, { force: true });
    mkdirSync(sandbox, { recursive: true });
    dir = materialize(task, sandbox);
    prepareArm(task, dir, arm, values.agent === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
    if (arm === 'custom') {
      const setup = values['setup-cmd'];
      if (setup) {
        const r = await runShell(fill(setup, { dir, prompt_file: '', prompt: '', model: values.model, task_dir: '' }), dir, process.env, 10 * 60_000);
        if (r.code !== 0) throw new Error(`--setup-cmd failed (${String(r.code)}): ${r.out.slice(-300)}`);
      }
    }
    outcome =
      values.agent === 'codex'
        ? await runCodex(task, dir, transcript, hookLog)
        : values.agent === 'cmd'
          ? await runCmd(task, dir, transcript, hookLog)
          : await runClaude(task, dir, arm, transcript, hookLog);
    if (!agentErrored(outcome)) break;
  }
  if (!outcome) throw new Error('no attempt ran');
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
    ...(values.label ? { label: values.label } : {}),
    model: MODEL,
    condition: values.condition,
    prompt: values.prompt,
    pass: hidden.pass,
    triggerInFinal: triggerPresent(task, dir),
    hookFired: fired.length,
    hookDenied: fired.filter((e) => e.decision === 'deny').length,
    hookCitedTarget: fired.some((e) => e.hits.some((h) => h.id === task.issue)),
    hookIds: [...new Set(fired.flatMap((e) => e.hits.map((h) => h.id)))],
    agentMentionedIssue: new RegExp(`#${issueNo}\\b|issues/${issueNo}\\b`).test(outcome.transcript),
    costUsd: outcome.costUsd,
    ...(outcome.tokens !== undefined ? { tokens: outcome.tokens } : {}),
    turns: outcome.turns,
    durationMs: outcome.durationMs,
    agentExit: outcome.exitCode,
    timedOut: outcome.timedOut,
    attempts: Math.min(attempts + 1, 4),
    ...(agentErrored(outcome) ? { agentError: true } : {}),
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
