import { type Binding, bindings as findBindings } from './bindings.js';
import { type Lang, lex } from './lex.js';

/** A local name that refers to something from a package: an import binding or a derived alias. */
interface Root {
  binding: Binding;
  /** Symbol to record when the root itself is used; undefined for derived aliases. */
  symbol: string | undefined;
}

export interface Touch {
  package: string;
  /** Exported/member names the changed text uses, in first-seen order. */
  symbols: string[];
}

const MAX_CHAIN = 6;

/**
 * One-level derived aliases: `const db = drizzle(...)`, `const c = new Client()`,
 * `s = requests.Session()`. The alias carries the binding's package.
 */
export function derivedAliases(code: string, binds: Binding[], lang: Lang): Map<string, Binding> {
  const byLocal = new Map(binds.map((b) => [b.local, b]));
  const aliases = new Map<string, Binding>();
  const re =
    lang === 'py'
      ? /(?<![\w.])([A-Za-z_]\w*)\s*(?::\s*[^=\n]+)?=(?!=)\s*(?:await\s+)?([A-Za-z_]\w*)\b/g
      : /(?<![\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=(?![=>])\s*(?:await\s+)?(?:new\s+)?([A-Za-z_$][\w$]*)\b/g;
  for (const m of code.matchAll(re)) {
    const [, name, source] = m;
    if (!name || !source || byLocal.has(name)) continue;
    const b = byLocal.get(source);
    if (b) aliases.set(name, b);
  }
  return aliases;
}

function rootsFor(binds: Binding[], aliases: Map<string, Binding>): Map<string, Root> {
  const roots = new Map<string, Root>();
  for (const [name, b] of aliases) roots.set(name, { binding: b, symbol: undefined });
  for (const b of binds) roots.set(b.local, { binding: b, symbol: b.kind === 'named' ? b.imported : b.local });
  return roots;
}

function skipBalanced(code: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return code.length;
}

/** Member names following `code[pos]`: `.a(...)?.b[0].c` → [a, b, c]. */
export function walkChain(code: string, pos: number, lang: Lang): string[] {
  const members: string[] = [];
  let i = pos;
  const ident = /^[A-Za-z_$][\w$]*/;
  while (members.length < MAX_CHAIN) {
    while (i < code.length && /\s/.test(code[i] ?? '')) i++;
    const c = code[i];
    if (c === '.' || (c === '?' && code[i + 1] === '.')) {
      i += c === '.' ? 1 : 2;
      while (i < code.length && /\s/.test(code[i] ?? '')) i++;
      const m = ident.exec(code.slice(i, i + 200));
      if (!m) {
        if (code[i] === '(' || code[i] === '[') continue; // ?.( / ?.[
        break;
      }
      members.push(m[0]);
      i += m[0].length;
    } else if (c === '(') i = skipBalanced(code, i, '(', ')');
    else if (c === '[') i = skipBalanced(code, i, '[', ']');
    else if (c === '!' && lang === 'js' && code[i + 1] !== '=') i++;
    else if (c === '<' && lang === 'js') {
      const end = skipBalanced(code, i, '<', '>');
      const inner = code.slice(i, end);
      if (end - i > 200 || !/^<[\w$\s,.<>[\]|&?:'"{}=]*>$/.test(inner)) break;
      let k = end;
      while (k < code.length && /\s/.test(code[k] ?? '')) k++;
      if (code[k] !== '(') break;
      i = end;
    } else break;
  }
  return members;
}

export interface TouchInput {
  /** Whole file as it will look after the edit (used to find imports and aliases). */
  fileText: string;
  /** Only the text the edit introduces. */
  changedText: string;
  lang: Lang;
}

/** Which package symbols does the changed text use? */
export function touches({ fileText, changedText, lang }: TouchInput): Touch[] {
  const fileLex = lex(fileText, lang);
  const binds = findBindings(fileText, lang, fileLex);
  if (binds.length === 0) return [];
  const roots = rootsFor(binds, derivedAliases(fileLex.code, binds, lang));
  const code = lex(changedText, lang).code;
  const byPackage = new Map<string, string[]>();
  const add = (pkg: string, sym: string): void => {
    const list = byPackage.get(pkg) ?? [];
    if (!list.includes(sym)) list.push(sym);
    byPackage.set(pkg, list);
  };
  const idRe = lang === 'py' ? /(?<![\w.])[A-Za-z_]\w*/g : /(?<![\w$.])[A-Za-z_$][\w$]*/g;
  for (const m of code.matchAll(idRe)) {
    const root = roots.get(m[0]);
    if (!root) continue;
    // Skip object keys (`{ drizzle: x }`) and declarations of the same name.
    const after = code.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3);
    if (/^\s*:(?!:)/.test(after) && lang === 'js' && /[{,]\s*$/.test(code.slice(Math.max(0, (m.index ?? 0) - 20), m.index))) continue;
    if (root.symbol) add(root.binding.package, root.symbol);
    for (const member of walkChain(code, (m.index ?? 0) + m[0].length, lang)) add(root.binding.package, member);
  }
  return [...byPackage].map(([pkg, symbols]) => ({ package: pkg, symbols }));
}
