// Arm setup for landmine-bench: what each arm adds to a task's working copy.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LandmineIndex } from '../../src/types.js';
import { BENCH, ROOT, type Task } from './lib.js';

export const ARMS = ['none', 'rules', 'hook', 'cards', 'cards-warn', 'rules+cards', 'rules-noisy', 'rules-noisy-conf', 'mcp'] as const;
/** A real project's carded index (46 dependencies) mixed into the task's, for the noisy rules arms (D-43). */
const NOISE = join(BENCH, 'fixtures', 'noise-fresh-a.json');

function addNoise(task: Task, dir: string): void {
  const file = join(dir, '.landmine', 'index.json');
  const own = JSON.parse(readFileSync(file, 'utf8')) as LandmineIndex;
  const noise = JSON.parse(readFileSync(NOISE, 'utf8')) as LandmineIndex;
  own.packages.push(...noise.packages.filter((p) => p.name !== task.package));
  own.landmines.push(...noise.landmines.filter((l) => l.package !== task.package));
  writeFileSync(file, `${JSON.stringify(own)}\n`);
}
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
  // The rules arm gets the cards too, so rules vs hook compares delivery, not information.
  if (arm === 'cards' || arm === 'cards-warn' || arm === 'rules' || arm === 'rules+cards' || arm.startsWith('rules-noisy')) cli(['cards', '--from', join(BENCH, 'fixtures', 'cards'), '-r', dir], dir);
  rmSync(join(dir, '.landmine', 'cache'), { recursive: true, force: true });
  if (arm === 'rules' || arm === 'rules+cards') cli(['rules', '--write', 'CLAUDE.md', '-r', dir], dir);
  if (arm.startsWith('rules-noisy')) {
    addNoise(task, dir);
    cli(['rules', '--write', 'CLAUDE.md', '--rank', arm === 'rules-noisy' ? 'usage' : 'confidence', '-r', dir], dir);
  }
  if (arm === 'hook' || arm === 'cards' || arm === 'rules+cards') cli(['install', '--harness', 'claude', '-r', dir], dir);
  // Every card match as non-blocking context: the agent learns about the bug without losing a turn.
  if (arm === 'cards-warn') cli(['install', '--harness', 'claude', '--mode', 'warn', '-r', dir], dir);
  if (arm === 'mcp') {
    writeFileSync(join(dir, '.mcp.json'), `${JSON.stringify({ mcpServers: { landmine: { command: process.execPath, args: [CLI, 'mcp'] } } }, null, 2)}\n`);
  }
}
