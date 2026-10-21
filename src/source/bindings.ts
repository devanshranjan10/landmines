import { type Lang, type Lexed, lex, stringAt } from './lex.js';
import { packageFromSpecifier } from './specifier.js';

export interface Binding {
  /** Name the binding has in this file. */
  local: string;
  /** Exported name (`default`, `*` for namespaces / Python modules). */
  imported: string;
  kind: 'named' | 'default' | 'namespace';
  /** npm package name, or Python top-level module name. */
  package: string;
  /** Full specifier / dotted module path as written. */
  specifier: string;
}

const ID = '[A-Za-z_$][\\w$]*';

export function bindings(text: string, lang: Lang, lexed: Lexed = lex(text, lang)): Binding[] {
  return lang === 'py' ? pyBindings(lexed) : jsBindings(lexed);
}

function parseNamedList(list: string, pkg: string, specifier: string, out: Binding[]): void {
  for (const raw of list.split(',')) {
    const item = raw.trim();
    if (!item || /^type\s/.test(item)) continue;
    const m = new RegExp(`^(${ID})(?:\\s+as\\s+(${ID}))?$`).exec(item);
    if (!m?.[1]) continue;
    const imported = m[1];
    const local = m[2] ?? imported;
    if (imported === 'default') out.push({ local, imported: 'default', kind: 'default', package: pkg, specifier });
    else out.push({ local, imported, kind: 'named', package: pkg, specifier });
  }
}

function parseDestructure(pattern: string, pkg: string, specifier: string, out: Binding[]): void {
  // { a, b: c, d = 1, ...rest }
  for (const raw of pattern.split(',')) {
    const item = raw.trim().replace(/\s*=.*$/, '');
    if (!item || item.startsWith('...')) continue;
    const m = new RegExp(`^(${ID})(?:\\s*:\\s*(${ID}))?$`).exec(item);
    if (!m?.[1]) continue;
    out.push({ local: m[2] ?? m[1], imported: m[1], kind: 'named', package: pkg, specifier });
  }
}

function jsBindings({ code, strings }: Lexed): Binding[] {
  const out: Binding[] = [];
  const spec = (quoteOffset: number): { pkg: string; specifier: string } | undefined => {
    const s = stringAt(strings, quoteOffset);
    if (!s) return undefined;
    const pkg = packageFromSpecifier(s.value);
    return pkg ? { pkg, specifier: s.value } : undefined;
  };

  // Static imports.
  const importRe = new RegExp(
    `(?<![\\w$.])import\\s+(type\\s+)?(?:(${ID})\\s*,?\\s*)?(?:\\{([^}]{0,3000})\\}|\\*\\s*as\\s+(${ID}))?\\s*from\\s*(['"])`,
    'g',
  );
  for (const m of code.matchAll(importRe)) {
    if (m[1]) continue; // import type ...
    const s = spec((m.index ?? 0) + m[0].length - 1);
    if (!s) continue;
    const def = m[2];
    if (def && def !== 'type') out.push({ local: def, imported: 'default', kind: 'default', package: s.pkg, specifier: s.specifier });
    if (m[3] !== undefined) parseNamedList(m[3], s.pkg, s.specifier, out);
    if (m[4]) out.push({ local: m[4], imported: '*', kind: 'namespace', package: s.pkg, specifier: s.specifier });
  }

  // TS: import x = require('m')
  for (const m of code.matchAll(new RegExp(`(?<![\\w$.])import\\s+(${ID})\\s*=\\s*require\\s*\\(\\s*(['"])`, 'g'))) {
    const s = spec((m.index ?? 0) + m[0].length - 1);
    if (s && m[1]) out.push({ local: m[1], imported: '*', kind: 'namespace', package: s.pkg, specifier: s.specifier });
  }

  // require('m') and import('m') assigned to a declaration.
  const callRe = /(?<![\w$.])(require|import)\s*\(\s*(['"])/g;
  for (const m of code.matchAll(callRe)) {
    const quote = (m.index ?? 0) + m[0].length - 1;
    const s = spec(quote);
    if (!s) continue;
    const lit = stringAt(strings, quote);
    const before = code.slice(Math.max(0, (m.index ?? 0) - 300), m.index);
    const decl = new RegExp(`(?:const|let|var)\\s+(\\{[^}]*\\}|${ID})\\s*=\\s*(?:await\\s+)?$`).exec(before);
    if (!decl?.[1]) continue;
    const after = code.slice(lit?.end ?? quote + 1);
    const member = new RegExp(`^\\s*\\)\\s*\\.\\s*(${ID})`).exec(after);
    const target = decl[1];
    if (target.startsWith('{')) parseDestructure(target.slice(1, -1), s.pkg, s.specifier, out);
    else if (member?.[1]) out.push({ local: target, imported: member[1], kind: 'named', package: s.pkg, specifier: s.specifier });
    else out.push({ local: target, imported: '*', kind: 'namespace', package: s.pkg, specifier: s.specifier });
  }
  return out;
}

function pyBindings({ code }: Lexed): Binding[] {
  const out: Binding[] = [];
  // Join backslash continuations and parenthesized import lists onto one logical line.
  const logical = code.replace(/\\\r?\n/g, ' ').replace(/\(([^()]{0,3000})\)/g, (_m, inner: string) => `(${inner.replace(/\s+/g, ' ')})`);
  for (const rawLine of logical.split(/\r?\n|;/)) {
    const line = rawLine.trim();
    const from = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(line);
    if (from?.[1] && from[2]) {
      const mod = from[1];
      if (mod.startsWith('.')) continue;
      const pkg = mod.split('.')[0] ?? mod;
      const names = from[2].replace(/[()]/g, '');
      for (const raw of names.split(',')) {
        const m = /^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/.exec(raw.trim());
        if (!m?.[1] || m[1] === '*') continue;
        out.push({ local: m[2] ?? m[1], imported: m[1], kind: 'named', package: pkg, specifier: mod });
      }
      continue;
    }
    const imp = /^import\s+(.+)$/.exec(line);
    if (imp?.[1]) {
      for (const raw of imp[1].split(',')) {
        const m = /^([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?$/.exec(raw.trim());
        if (!m?.[1]) continue;
        const mod = m[1];
        const pkg = mod.split('.')[0] ?? mod;
        // `import a.b` binds `a`; `import a.b as c` binds `c` to the submodule.
        out.push({ local: m[2] ?? pkg, imported: '*', kind: 'namespace', package: pkg, specifier: mod });
      }
    }
  }
  return out;
}
