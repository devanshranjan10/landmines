import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIPREQS_MAPPING } from './data/pipreqsMapping.js';
import { pep503 } from './lockfiles/python.js';

/** site-packages directories of virtualenvs at the project root (and $VIRTUAL_ENV). */
export function sitePackagesDirs(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const venvs = ['.venv', 'venv', 'env', '.env'].map((v) => join(root, v));
  if (env.VIRTUAL_ENV) venvs.unshift(env.VIRTUAL_ENV);
  const dirs: string[] = [];
  for (const venv of venvs) {
    const winSite = join(venv, 'Lib', 'site-packages');
    if (existsSync(winSite)) dirs.push(winSite);
    const lib = join(venv, 'lib');
    let entries: string[];
    try {
      entries = readdirSync(lib);
    } catch {
      continue;
    }
    for (const e of entries) if (/^python\d/.test(e) && existsSync(join(lib, e, 'site-packages'))) dirs.push(join(lib, e, 'site-packages'));
  }
  return dirs;
}

function fromDistInfo(dir: string, dist: string): string[] | undefined {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  const info = entries.find((e) => e.endsWith('.dist-info') && pep503(e.replace(/\.dist-info$/, '').replace(/-[^-]+$/, '')) === dist);
  if (!info) return undefined;
  const read = (f: string): string | undefined => {
    try {
      return readFileSync(join(dir, info, f), 'utf8');
    } catch {
      return undefined;
    }
  };
  const names = new Set<string>();
  const top = read('top_level.txt');
  if (top) for (const l of top.split(/\r?\n/)) if (l.trim()) names.add(l.trim());
  if (names.size === 0) {
    const record = read('RECORD') ?? '';
    for (const line of record.split(/\r?\n/)) {
      const path = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : (line.split(',')[0] ?? '');
      const first = path.split('/')[0] ?? '';
      if (!first || first.startsWith('..') || /\.(dist-info|data|pth)$/.test(first) || first === '__pycache__' || first === 'bin') continue;
      const mod = first.replace(/\.py$/, '').replace(/\.(cpython-[\w-]+|abi3|cp\d+[\w-]*)?\.(so|pyd)$/, '');
      if (/^[A-Za-z_]\w*$/.test(mod)) names.add(mod);
    }
  }
  return names.size ? [...names] : undefined;
}

/**
 * Top-level module names a PyPI distribution provides.
 * Order of truth: installed *.dist-info, then the pipreqs mapping, then the normalized name.
 */
export function importNamesFor(dist: string, root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const d = pep503(dist);
  for (const dir of sitePackagesDirs(root, env)) {
    const found = fromDistInfo(dir, d);
    if (found) return found;
  }
  const mapped = PIPREQS_MAPPING[d];
  if (mapped?.length) return [...mapped];
  const base = d.replace(/-/g, '_');
  return [...new Set([base, base.replace(/^python_/, ''), base.replace(/_python$/, '')])].filter(Boolean);
}
