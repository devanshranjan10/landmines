import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { armedSymbols } from './policy.js';
import { bindings } from './source/bindings.js';
import { langForPath } from './source/lang.js';
import { lex } from './source/lex.js';
import type { LandmineIndex } from './types.js';

const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', 'env', 'dist', 'build', 'out', '.landmine', '__pycache__', '.next', 'coverage', 'site-packages']);
const MAX_FILES = 3000;
const MAX_BYTES = 1_000_000;

/** Source files under `root` landmine can read, skipping dependencies and build output. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= MAX_FILES) return;
      if (SKIP.has(name) || (name.startsWith('.') && name !== '.')) continue;
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(path);
      else if (st.size <= MAX_BYTES && langForPath(path)) out.push(path);
    }
  };
  walk(root);
  return out;
}

/**
 * How much the project's own code has to do with each issue: 2 when a file that imports the package also uses one of
 * the issue's APIs, 1 when the package is imported somewhere, 0 otherwise. Used to rank the rules section, so a
 * project with hundreds of indexed issues lists the ones its code is closest to.
 */
export function projectUsage(root: string, index: LandmineIndex): Map<string, 0 | 1 | 2> {
  const imported = new Map<string, Set<string>>(); // import name -> identifiers used in files importing it
  for (const file of sourceFiles(root)) {
    const lang = langForPath(file);
    if (!lang) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lexed = lex(text, lang);
    const pkgs = new Set(bindings(text, lang, lexed).map((b) => b.package));
    if (pkgs.size === 0) continue;
    const ids = new Set(lexed.code.match(/[A-Za-z_$][\w$]*/g) ?? []);
    for (const p of pkgs) {
      const seen = imported.get(p) ?? new Set<string>();
      for (const id of ids) seen.add(id);
      imported.set(p, seen);
    }
  }
  const usage = new Map<string, 0 | 1 | 2>();
  for (const l of index.landmines) {
    const pkg = index.packages.find((p) => p.ecosystem === l.ecosystem && p.name === l.package && p.version === l.version);
    const names = l.ecosystem === 'pypi' ? (pkg?.importNames ?? [l.package]) : [l.package];
    const ids = names.map((n) => imported.get(n)).filter((s): s is Set<string> => Boolean(s));
    if (ids.length === 0) {
      usage.set(`${l.id}@${l.version}`, 0);
      continue;
    }
    const apis = (l.card?.apis.length ? l.card.apis : armedSymbols(l)).map((a) => a.split(/[./]/).at(-1) ?? a);
    usage.set(`${l.id}@${l.version}`, apis.some((a) => ids.some((s) => s.has(a))) ? 2 : 1);
  }
  return usage;
}
