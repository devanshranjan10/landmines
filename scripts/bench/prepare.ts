// Arm setup for landmine-bench: what each arm adds to a task's working copy.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH, ROOT, type Task } from './lib.js';

export const ARMS = ['none', 'rules', 'hook', 'cards', 'mcp'] as const;
export type Arm = (typeof ARMS)[number];
export const CLI = join(ROOT, 'dist', 'cli.js');

export function cli(args: string[], cwd: string): string {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`landmine ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** Give the working copy what the arm adds: an index (rebuilt offline from frozen raw data), then a rules section, hook, cards or MCP server. */
export function prepareArm(task: Task, dir: string, arm: Arm): void {
  if (arm === 'none') return;
  const file = `${encodeURIComponent(task.package)}@${encodeURIComponent(task.version)}.json`;
  const cacheDir = join(dir, '.landmine', 'cache', task.ecosystem);
  mkdirSync(cacheDir, { recursive: true });
  cpSync(join(BENCH, 'fixtures', 'cache', task.ecosystem, file), join(cacheDir, file));
  cli(['scan', '--offline', '-q', '-r', dir], dir);
  if (arm === 'cards') cli(['cards', '--from', join(BENCH, 'fixtures', 'cards'), '-r', dir], dir);
  rmSync(join(dir, '.landmine', 'cache'), { recursive: true, force: true });
  if (arm === 'rules') cli(['rules', '--write', 'CLAUDE.md', '-r', dir], dir);
  if (arm === 'hook' || arm === 'cards') cli(['install', '--harness', 'claude', '-r', dir], dir);
  if (arm === 'mcp') {
    writeFileSync(join(dir, '.mcp.json'), `${JSON.stringify({ mcpServers: { landmine: { command: process.execPath, args: [CLI, 'mcp'] } } }, null, 2)}\n`);
  }
}
