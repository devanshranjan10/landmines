import type { RawIssue } from '../github/issues.js';
import { bindings } from '../source/bindings.js';
import { langForFence } from '../source/lang.js';
import type { Lang } from '../source/lex.js';
import { touches } from '../source/touches.js';
import type { IssueSymbol, SymbolSource } from '../types.js';
import { isDialectWord } from './dialect.js';
import { codeSpans, codeSpansInContext, dropQuotes, dropTaskLists, splitFences, stripNoise } from './markdown.js';

/** Conventional import aliases: a chain rooted here is rooted at the package. */
const CONVENTIONAL_ALIASES = new Set(['np', 'pd', 'plt', 'sns', 'px', 'go', 'tf', 'nn', 'F', 'th', 'sp', 'nx', 'mpl', 'pl', 'xr', 'dd', 'sk', 'jnp']);

export const WEIGHT: Record<SymbolSource, number> = { title: 1.0, span: 0.7, code: 0.5, import: 0.2 };

/** Names too common to identify a bug on their own. They still count inside a pair (`insert.values`). */
export const GENERIC = new Set(
  `get set map filter find then catch finally push pop slice length keys values entries tostring valueof data value error errors
  default config options opts type types name id use new init run start stop end test call apply bind create update delete remove
  add list all one first last next query from where select insert exec execute send open close read write load save parse render
  format log info warn debug fetch request response req res result results items item key user users count size url path file
  text json body headers status code message props state ref current children handler callback fn args kwargs self this cls obj
  instance client db app router server model schema table column field fields record row rows index object string number boolean
  array date time event events node nodes element component page view main utils helpers lib src dist build module exports require
  import export return async await promise resolve reject string int float bool dict tuple str none true false null undefined
  min max sum avg is has on off emit with as to of in out api http https www com org github issue issues bug fix version
  float16 float32 float64 bfloat16 int8 int16 int32 int64 uint8 uint16 uint32 uint64 complex64 complex128 bool_ object_ dtype dtypes
  cuda cpu gpu mps device tensor tensors edges edge graph`
    .split(/\s+/)
    .filter(Boolean),
);

const KEYWORDS = new Set(
  `break case catch class const continue debugger default delete do else enum export extends false finally for function if import
  in instanceof let new null return super switch this throw true try typeof var void while with yield async await static get set
  interface type implements package private protected public readonly declare abstract as any unknown never keyof infer is
  def elif except lambda nonlocal not or pass raise and assert del global from None True False self cls print`
    .split(/\s+/)
    .filter(Boolean),
);

/** `db.$client.end()` → [[db, $client, end]]; `Annotated[Final[int], ...]` → [[Annotated], [Final], [int]]. */
export function chainsIn(text: string): string[][] {
  const chains: string[][] = [];
  // Kebab-case words (`drizzle-orm`, `node-postgres`) are names of things, not identifiers.
  const re = /(?<![-\w$])[A-Za-z_$][\w$]*(?:\s*(?:\([^()]*\))?\s*\??\.\s*[A-Za-z_$][\w$]*)*(?![\w$]|-\w)/g;
  for (const m of text.matchAll(re)) {
    const segs = m[0]
      .replace(/\([^()]*\)/g, '')
      .split(/\s*\??\.\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segs.length) chains.push(segs);
  }
  return chains;
}

/** Title words that look like code: camelCase, PascalCase with 2+ capitals, snake_case, $x, x(), a.b. */
const CODEISH = /^(?:[a-z]+[A-Z][\w$]*|[A-Z][a-z0-9]+[A-Z][\w$]*|[A-Za-z]*_[\w$]*|\$[\w$]+)$/;

const FILE_EXT = /^(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|json|ya?ml|md|mdx|py|pyi|txt|lock|toml|sql|css|scss|html|env|pem|key|crt|sh|png|jpg|svg|log|ini|cfg|conf|config|vue|svelte|d)$/i;
const NOT_IMPORT_SEGMENT = /^(?:src|dist|lib|build|node_modules|esm|cjs|es|umd|out|types|test|tests|__tests__)$/;

/** Inline code that is prose (error messages, sentences) rather than code. */
export function looksLikeCode(span: string): boolean {
  if (/https?:\/\/|www\.|^[\w-]+(\.[\w-]+)+\/|\.(io|com|org|net|dev|app|sh)\b|localhost|\b\d+\.\d+\.\d+\.\d+\b|^@?[\w-]+@[\d^~]/i.test(span)) return false;
  if (!/\s/.test(span.trim())) return true;
  return /[(){}[\]=<>;]|\w\.\w|=>|::/.test(span);
}

/** Chains in an inline code span; for spans with spaces, only the ones that look like code. */
export function spanChains(span: string): string[][] {
  const chains = chainsIn(span);
  if (!/\s/.test(span.trim())) return chains;
  return chains.filter((c) => {
    const head = c[0] ?? '';
    return c.length > 1 || CODEISH.test(head) || new RegExp(`${head.replace(/\$/g, '\\$')}\\(`).test(span);
  });
}

/** `foo.ts`, `localhost-key.pem`, `drizzle.config` are file names, not APIs. */
function isFileName(chain: string[]): boolean {
  const last = chain.at(-1) ?? '';
  return chain.length > 1 && FILE_EXT.test(last);
}

export interface SymbolContext {
  packageName: string;
  /** Names that refer to the package itself (never symbols). */
  packageAliases: string[];
  /** For PyPI: modules the distribution provides (`bs4`). For npm: [packageName]. */
  importNames: string[];
  lang: Lang;
}

/** "you can still use `np.ma.ptp`", "`foo` works fine": the span names the alternative, not the bug. */
const ALTERNATIVE = /\b(still use|can use|could use|instead|alternative|work[- ]?around|works(?: fine| as expected| correctly)?|is fine|no problem)\b/i;
const BUG_WORDS = /\b(fail\w*|error\w*|wrong|broken|bug|incorrect\w*|crash\w*|nan|unexpected\w*|doesn'?t|does not|not work\w*|cannot|can'?t|throws?|raises?)\b/i;
export const ALTERNATIVE_WEIGHT = 0.3;

class Scores {
  private readonly bySymbol = new Map<string, Map<SymbolSource, number>>();
  add(name: string, source: SymbolSource, weight: number = WEIGHT[source]): void {
    const m = this.bySymbol.get(name) ?? new Map<SymbolSource, number>();
    m.set(source, Math.max(m.get(source) ?? 0, weight));
    this.bySymbol.set(name, m);
  }
  has(name: string): boolean {
    return this.bySymbol.has(name);
  }
  entries(): Array<[string, Map<SymbolSource, number>]> {
    return [...this.bySymbol];
  }
}

/** Builtin error and warning classes say what failed, not which API. Package-specific ones (PrismaClientKnownRequestError) stay. */
const BUILTIN_ERROR =
  /^(?:(?:Type|Value|Range|Reference|Syntax|Runtime|Import|ModuleNotFound|Attribute|Key|Index|OS|IO|Assertion|NotImplemented|Overflow|ZeroDivision|Recursion|Memory|Lookup|Name|Unicode\w*|Timeout|Connection\w*|Permission|FileNotFound|Eval|URI|Aggregate|Internal)(?:Error|Exception)|(?:Future|Deprecation|User|Runtime|Pending\w*|Syntax|Resource|Import|Unicode)Warning|Error|Exception|Warning)$/;
/** Release tags (`dev20240708`, `rc1`) that leak out of version strings. */
const RELEASE_TAG = /^(?:dev|rc|post|alpha|beta|pre|canary|nightly)\d+$/i;

function isCandidate(name: string, ctx: SymbolContext): boolean {
  if (name.length < 2 || /^\d/.test(name) || KEYWORDS.has(name) || BUILTIN_ERROR.test(name) || RELEASE_TAG.test(name)) return false;
  if (isDialectWord(name)) return false;
  const lower = name.toLowerCase();
  if (ctx.packageAliases.some((a) => a.toLowerCase() === lower)) return false;
  if (ctx.importNames.some((a) => a.toLowerCase() === lower)) return false;
  return true;
}

function specificity(name: string): number {
  if (name.includes('.') || name.includes('/')) {
    // pair or deep import: generic only if every part is generic
    const parts = name.split(/[./]/);
    return parts.every((p) => GENERIC.has(p.toLowerCase()) || p.length <= 2) ? 0.35 : 1;
  }
  return GENERIC.has(name.toLowerCase()) || name.length <= 3 ? 0.35 : 1;
}

/** Deep import paths of this package mentioned in text: `next/dynamic`, `drizzle-orm/node-postgres`. */
function deepImports(text: string, ctx: SymbolContext): string[] {
  const out: string[] = [];
  for (const base of ctx.importNames) {
    const sep = ctx.lang === 'py' ? '\\.' : '/';
    const re = new RegExp(`(?<![\\w@/.-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${sep}[\\w$-]+(?:${sep}[\\w$-]+)*`, 'g');
    for (const m of text.matchAll(re)) {
      const segs = m[0].split(/[/.]/).slice(1);
      if (segs.some((s) => NOT_IMPORT_SEGMENT.test(s)) || FILE_EXT.test(segs.at(-1) ?? '')) continue;
      // Python modules are lowercase; `pandas.DataFrame` is a class, not a deep import.
      if (ctx.lang === 'py' && !segs.every((s) => /^[a-z_][a-z0-9_]*$/.test(s))) continue;
      out.push(m[0]);
    }
  }
  return out;
}

/** Score the code symbols an issue is about, from its title and body (never from comments). */
export function issueSymbols(issue: Pick<RawIssue, 'title' | 'body'>, ctx: SymbolContext): IssueSymbol[] {
  const scores = new Scores();
  const body = dropQuotes(dropTaskLists(stripNoise(issue.body)));
  const { prose, fences } = splitFences(body);

  const roots = new Set([...ctx.importNames, ...ctx.packageAliases].map((r) => r.toLowerCase()));
  const namespaces = new Set<string>();
  const addChains = (chains: string[][], source: SymbolSource, weight?: number): void => {
    for (const chain of chains) {
      if (isFileName(chain)) continue;
      // In `torch.cuda.memory.change_current_allocator`, `cuda` and `memory` are namespaces of the package:
      // touching them says nothing about which API is buggy.
      const head = chain[0] ?? '';
      if (chain.length > 2 && (roots.has(head.toLowerCase()) || CONVENTIONAL_ALIASES.has(head))) {
        for (const seg of chain.slice(1, -1)) if (/^_?[a-z][a-z0-9_]*$/.test(seg)) namespaces.add(seg);
      }
      for (const seg of chain) if (isCandidate(seg, ctx)) scores.add(seg, source, weight);
      for (let k = 1; k < chain.length; k++) {
        const a = chain[k - 1];
        const b = chain[k];
        // `pandas.DataFrame` is just `DataFrame`: a pair headed by the package adds nothing and would dodge its penalties.
        if (a && b && isCandidate(b, ctx) && !roots.has(a.toLowerCase()) && !CONVENTIONAL_ALIASES.has(a)) scores.add(`${a}.${b}`, source, weight);
      }
    }
  };

  // Title: backticked spans and code-looking words.
  const titleSpans = codeSpans(issue.title).filter(looksLikeCode);
  addChains(titleSpans.flatMap(spanChains), 'title');
  const titleWords = issue.title
    .replace(/`[^`]*`/g, ' ')
    .split(/[^\w$.()]+/)
    .map((w) => w.replace(/^[.(]+|[.]+$/g, ''))
    .filter(Boolean);
  const titleCodeish = titleWords.filter((w) => /\(\)|[\w$]\.[\w$]/.test(w) || CODEISH.test(w.replace(/\(\)$/, '')));
  addChains(titleCodeish.flatMap(chainsIn), 'title');

  // Body inline code. Multi-word spans (error messages) only contribute code-looking tokens; spans
  // named as the alternative that works count for little.
  const inContext = codeSpansInContext(prose).filter((c) => looksLikeCode(c.span));
  const spans = inContext.map((c) => c.span);
  for (const c of inContext) {
    const alternative = ALTERNATIVE.test(c.sentence) && !BUG_WORDS.test(c.sentence);
    addChains(spanChains(c.span), 'span', alternative ? ALTERNATIVE_WEIGHT : undefined);
  }

  // Fenced code: bindings imported from this package, and the members used on them.
  for (const fence of fences) {
    const lang = langForFence(fence.info) ?? (fence.info ? undefined : ctx.lang);
    if (lang !== ctx.lang) continue;
    const ours = bindings(fence.code, lang).filter((b) => ctx.importNames.includes(b.package));
    for (const b of ours) {
      const sym = b.kind === 'named' ? b.imported : undefined;
      if (sym && isCandidate(sym, ctx)) scores.add(sym, 'import');
    }
    if (ours.length === 0) continue;
    for (const t of touches({ fileText: fence.code, changedText: fence.code, lang })) {
      if (!ctx.importNames.includes(t.package)) continue;
      for (const sym of t.symbols) {
        const isAliasName = ours.some((b) => b.kind !== 'named' && b.local === sym);
        if (isAliasName || !isCandidate(sym, ctx)) continue;
        // Calling the imported entry point (`drizzle(...)`, `useQuery(...)`) in a repro says little about
        // what the bug is; members used on it say more. Neither can trigger the hook without prose support.
        const isRoot = ours.some((b) => b.kind === 'named' && b.imported === sym);
        scores.add(sym, isRoot ? 'import' : 'code');
      }
      for (const p of t.pairs) {
        const [a, b] = p.split('.');
        if (a && b && isCandidate(b, ctx)) scores.add(p, 'code');
      }
      for (const spec of t.specifiers) scores.add(spec, 'import');
    }
  }

  // Deep import paths anywhere in the author's text.
  for (const spec of deepImports(issue.title, ctx)) scores.add(spec, 'title');
  for (const spec of deepImports(spans.join(' '), ctx)) scores.add(spec, 'span');

  // Plain title words confirmed as code elsewhere in the body.
  for (const w of titleWords) {
    const word = w.replace(/[().]+$/, '');
    if (isCandidate(word, ctx) && scores.has(word)) scores.add(word, 'title');
  }

  const out: IssueSymbol[] = [];
  for (const [name, sources] of scores.entries()) {
    const raw = Math.min(1, [...sources.values()].reduce((a, b) => a + b, 0));
    const isNamespace = namespaces.has(name) || name.split('.').every((p) => namespaces.has(p) || roots.has(p.toLowerCase()) || CONVENTIONAL_ALIASES.has(p));
    const score = Math.round(raw * (isNamespace ? 0.35 : specificity(name)) * 100) / 100;
    out.push({ name, score, sources: [...sources.keys()] });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
