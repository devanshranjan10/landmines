import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { langForPath } from './source/lang.js';

/** A staged JS/TS/Python file: its staged content and the lines the commit adds. */
export interface StagedFile {
  path: string;
  fileText: string;
  changedText: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Lines a unified diff adds (without the `+`), in order. */
export function addedLines(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

/**
 * Staged files landmine can read, for `landmine check --staged` (a pre-commit fallback for agents without hooks).
 * Uses the index, not the working tree, so it checks exactly what will be committed.
 */
export function stagedFiles(cwd: string): StagedFile[] {
  const top = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const names = git(top, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
  const out: StagedFile[] = [];
  for (const name of names) {
    if (!langForPath(name)) continue;
    const fileText = git(top, ['show', `:${name}`]);
    const changedText = addedLines(git(top, ['diff', '--cached', '-U0', '--no-color', '--', name]));
    out.push({ path: join(top, name), fileText, changedText });
  }
  return out;
}
