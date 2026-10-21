import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Dependency, LockfileResult, SkippedDependency } from '../types.js';
import { parseBunLock } from './bun.js';
import { readPackageJson, readText } from './common.js';
import { parseNpmLock } from './npm.js';
import { parsePnpmLock } from './pnpm.js';
import { parsePipfileLock, parsePoetryLock, parseRequirements, parseUvLock } from './python.js';
import { parseYarnLock } from './yarn.js';

const NPM_LOCKS = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'npm-shrinkwrap.json', 'package-lock.json'] as const;
const PY_LOCKS = ['uv.lock', 'poetry.lock', 'Pipfile.lock'] as const;
const MARKERS = [...NPM_LOCKS, ...PY_LOCKS, 'bun.lockb', 'requirements.txt'];

/** Walk up from `start` to the first directory containing a supported lockfile. */
export function findProjectRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (MARKERS.some((m) => existsSync(join(dir, m))) || requirementFiles(dir).length > 0) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function requirementFiles(root: string): string[] {
  const files: string[] = [];
  const list = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      return;
    }
    for (const n of names.sort()) {
      if (/^requirements.*\.txt$/i.test(n) || (prefix && /\.txt$/i.test(n))) files.push(prefix + n);
    }
  };
  list('', '');
  list('requirements', 'requirements/');
  return files;
}

/** Pick which npm-family lockfile is authoritative. `packageManager` wins; otherwise a fixed priority. */
export function pickNpmLock(root: string): string | undefined {
  const present = NPM_LOCKS.filter((f) => existsSync(join(root, f)));
  if (present.length === 0) return undefined;
  const pm = readPackageJson(root)?.packageManager?.split('@')[0];
  const preferred: Record<string, string[]> = {
    pnpm: ['pnpm-lock.yaml'],
    yarn: ['yarn.lock'],
    bun: ['bun.lock'],
    npm: ['npm-shrinkwrap.json', 'package-lock.json'],
  };
  const fromPm = pm ? preferred[pm]?.find((f) => present.includes(f as (typeof NPM_LOCKS)[number])) : undefined;
  if (fromPm) return fromPm;
  // npm-shrinkwrap.json takes precedence over package-lock.json when both exist.
  return present[0];
}

export interface ReadResult {
  deps: Dependency[];
  skipped: SkippedDependency[];
  lockfiles: string[];
  notes: string[];
}

/** Read every supported lockfile at `root` and return exact direct dependency versions. */
/** Run a lockfile parser, naming the file when it fails (a merge-conflicted lockfile otherwise says only "Unexpected token"). */
function parsing<T>(file: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new Error(`could not parse ${file}: ${(err as Error).message}`, { cause: err });
  }
}

export function readDependencies(root: string, opts: { prod?: boolean } = {}): ReadResult {
  const results: LockfileResult[] = [];
  const lockfiles: string[] = [];
  const notes: string[] = [];

  const npmLock = pickNpmLock(root);
  if (npmLock) {
    lockfiles.push(npmLock);
    const text = readText(join(root, npmLock)) ?? '';
    const pkg = readPackageJson(root);
    results.push(
      parsing(npmLock, () =>
        npmLock === 'pnpm-lock.yaml'
          ? parsePnpmLock(text, npmLock)
          : npmLock === 'yarn.lock'
            ? parseYarnLock(text, root, pkg, npmLock)
            : npmLock === 'bun.lock'
              ? parseBunLock(text, npmLock)
              : parseNpmLock(text, pkg, npmLock),
      ),
    );
  } else if (existsSync(join(root, 'bun.lockb'))) {
    notes.push('bun.lockb (binary) is not supported. Run `bun install --save-text-lockfile` to write bun.lock.');
  }

  const pyLock = PY_LOCKS.find((f) => existsSync(join(root, f)));
  if (pyLock === 'uv.lock') results.push(parsing(pyLock, () => parseUvLock(join(root, pyLock), pyLock)));
  else if (pyLock === 'poetry.lock') results.push(parsing(pyLock, () => parsePoetryLock(join(root, pyLock), join(root, 'pyproject.toml'), pyLock)));
  else if (pyLock === 'Pipfile.lock') results.push(parsing(pyLock, () => parsePipfileLock(join(root, pyLock), join(root, 'Pipfile'), pyLock)));
  if (pyLock) lockfiles.push(pyLock);
  else {
    for (const req of requirementFiles(root)) {
      lockfiles.push(req);
      results.push(parsing(req, () => parseRequirements(join(root, req), root, req)));
    }
  }

  const byKey = new Map<string, Dependency>();
  for (const r of results) {
    for (const d of r.deps) {
      const key = `${d.ecosystem}:${d.name}@${d.version}`;
      const prev = byKey.get(key);
      if (prev) prev.dev = prev.dev && d.dev;
      else byKey.set(key, { ...d });
    }
  }
  let deps = [...byKey.values()];
  if (opts.prod) deps = deps.filter((d) => !d.dev);
  deps.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const resolvedNames = new Set(deps.map((d) => `${d.ecosystem}:${d.name}`));
  const skipped = results.flatMap((r) => r.skipped).filter((s) => !resolvedNames.has(`${s.ecosystem}:${s.name}`) || s.reason !== 'missing');
  return { deps, skipped, lockfiles, notes };
}
