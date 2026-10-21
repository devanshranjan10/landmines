import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LandmineIndex } from './types.js';

export const INDEX_DIR = '.landmine';
export const INDEX_FILE = 'index.json';

export function indexPath(root: string): string {
  return join(root, INDEX_DIR, INDEX_FILE);
}

export function readIndex(root: string): LandmineIndex | undefined {
  const path = indexPath(root);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LandmineIndex>;
    if (parsed.schema !== 1 || !Array.isArray(parsed.landmines) || !Array.isArray(parsed.packages)) return undefined;
    return parsed as LandmineIndex;
  } catch {
    return undefined;
  }
}

/** Atomic write so a concurrently running hook never reads half a file. */
export function writeIndex(root: string, index: LandmineIndex): string {
  const path = indexPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}

/** Nearest directory at or above `start` that has a landmine index. */
export function findIndexRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(indexPath(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Keep machine-specific or bulky files out of git: raw API responses (`cache/`) and the install registry
 * (`installed.json`, which records this machine's hook commands). index.json and cards/ are meant to be committed.
 */
export function ensureIndexGitignore(root: string): void {
  const file = join(root, INDEX_DIR, '.gitignore');
  const wanted = ['cache/', 'installed.json'];
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    text = '# landmine: raw GitHub/registry responses and this machine\'s install registry; index.json and cards/ can be committed\n';
  }
  const lines = new Set(text.split('\n').map((l) => l.trim()));
  const missing = wanted.filter((w) => !lines.has(w));
  if (missing.length === 0 && text.length > 0 && existsSync(file)) return;
  mkdirSync(join(root, INDEX_DIR), { recursive: true });
  writeFileSync(file, `${text.replace(/\n*$/, '\n')}${missing.join('\n')}${missing.length ? '\n' : ''}`);
}
