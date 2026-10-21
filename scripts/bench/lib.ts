// Shared helpers for landmine-bench (bench/). Not shipped in the npm package.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const BENCH = join(ROOT, 'bench');
export const TASKS = join(BENCH, 'tasks');
export const VENV = join(BENCH, '.venv');

/** The pinned Python environment a task runs in: bench/.venv (2024 set) or bench/.venv-<name>. */
export function venvFor(task: Pick<Task, 'venv'>): string {
  return join(BENCH, task.venv ?? '.venv');
}

export interface Task {
  id: string;
  issue: string;
  related?: string[];
  ecosystem: 'npm' | 'pypi';
  package: string;
  version: string;
  tier: 'A' | 'B';
  /** Files the agent is expected to edit, relative to the project root. */
  entry: string[];
  /** argv for the hidden test, run from the working directory. `{python}` and `{node}` are substituted. */
  test: string[];
  env?: Record<string, string>;
  /** Static check of the final code: does it still call the buggy API in the triggering way? */
  trigger: { regex: string; about: string };
  summary: string;
  /** `2024`: pins from October 2024 (bugs a 2026 model may know). `fresh`: issues filed after 2026-07-01. */
  set?: '2024' | 'fresh';
  /** Python env directory under bench/ (default `.venv`). */
  venv?: string;
  dir: string;
}

export function loadTasks(ids?: string[]): Task[] {
  const all = readdirSync(TASKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(TASKS, d.name, 'task.json')))
    .map((d) => ({ ...(JSON.parse(readFileSync(join(TASKS, d.name, 'task.json'), 'utf8')) as Omit<Task, 'dir'>), dir: join(TASKS, d.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return ids?.length ? all.filter((t) => ids.includes(t.id)) : all;
}

export function prompt(task: Task): string {
  return readFileSync(join(task.dir, 'prompt.txt'), 'utf8').trim();
}

/** Copy the task's project into a fresh directory the agent may edit. */
export function materialize(task: Task, base = tmpdir()): string {
  const dir = mkdtempSync(join(base, `lmb-${task.id}-`));
  cpSync(join(task.dir, 'project'), dir, { recursive: true });
  if (task.ecosystem === 'npm' && !existsSync(join(dir, 'node_modules'))) {
    const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`npm ci failed for ${task.id}: ${r.stderr}`);
  }
  if (task.ecosystem === 'pypi') symlinkSync(venvFor(task), join(dir, '.venv'));
  return dir;
}

/** Overlay a reference solution (`naive` or `fixed`) onto a working directory. */
export function applyReference(task: Task, dir: string, which: 'naive' | 'fixed'): void {
  cpSync(join(task.dir, 'reference', which), dir, { recursive: true });
}

export interface HiddenResult {
  pass: boolean;
  exitCode: number | null;
  output: string;
  ms: number;
}

/** Run the hidden test against a working directory. The hidden files are copied in only for the run. */
export function runHidden(task: Task, dir: string): HiddenResult {
  const hidden = join(dir, 'hidden');
  rmSync(hidden, { recursive: true, force: true });
  cpSync(join(task.dir, 'hidden'), hidden, { recursive: true });
  const argv = task.test.map((a) => a.replace('{python}', join(venvFor(task), 'bin', 'python')).replace('{node}', process.execPath));
  const started = Date.now();
  const r = spawnSync(argv[0] ?? 'false', argv.slice(1), {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', MPLBACKEND: 'Agg', ...task.env },
  });
  rmSync(hidden, { recursive: true, force: true });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000);
  return { pass: r.status === 0, exitCode: r.status, output, ms: Date.now() - started };
}

/** Does the final code still contain the triggering use of the buggy API? */
export function triggerPresent(task: Task, dir: string): boolean {
  const re = new RegExp(task.trigger.regex, 'm');
  return task.entry.some((f) => {
    const p = join(dir, f);
    return existsSync(p) && re.test(readFileSync(p, 'utf8'));
  });
}
