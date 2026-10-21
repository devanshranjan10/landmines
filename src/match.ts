import { readFileSync } from 'node:fs';
import { fileDialects, isDialectWord } from './analyze/dialect.js';
import { GENERIC } from './analyze/issueSymbols.js';
import { bindings } from './source/bindings.js';
import { langForPath } from './source/lang.js';
import type { Lang } from './source/lex.js';
import { type Touch, touches } from './source/touches.js';
import { SYMBOL_THRESHOLD } from './policy.js';
import type { Landmine, LandmineIndex } from './types.js';

export interface Hit {
  landmine: Landmine;
  /** The touched symbol that matched. */
  symbol: string;
  score: number;
  rank: number;
  /**
   * A second, issue-specific symbol (an option, plugin, driver import…) that the file also contains.
   * Only corroborated hits block an edit; the rest are passed on as a heads-up.
   */
  corroboratedBy?: string;
}

const STRENGTH_WEIGHT = { strong: 1, medium: 0.7, weak: 0 } as const;

/** Index keys a touch's package can refer to: npm name, or PyPI dist whose import names include the module. */
function packagesFor(touch: Touch, lang: Lang, index: LandmineIndex): Set<string> {
  const keys = new Set<string>();
  for (const p of index.packages) {
    if (lang === 'js' && p.ecosystem === 'npm' && p.name === touch.package) keys.add(`npm:${p.name}@${p.version}`);
    if (lang === 'py' && p.ecosystem === 'pypi' && (p.importNames ?? [p.name]).includes(touch.package)) keys.add(`pypi:${p.name}@${p.version}`);
  }
  return keys;
}

export interface MatchContext {
  /** Databases the edited file uses (imports, connection URLs); see analyze/dialect.ts. */
  dialects?: Set<string>;
  /** Raw file text and its identifier tokens, for corroboration. */
  fileText?: string;
  tokens?: Set<string>;
  /** Import names of PyPI packages (`sklearn`), so they are never "novel" corroborators. */
  packageRoots?: string[];
  /** Everything the whole file uses from each package (not just the edit). */
  fileTouches?: Touch[];
  /** The file-wide touch for the package being matched (set per match). */
  fileTouch?: Touch;
}

/** What the whole edited file tells us beyond the touched symbols. */
export function fileContext(fileText: string, lang: Lang): MatchContext {
  const specs = bindings(fileText, lang).map((b) => b.specifier);
  const tokens = new Set(fileText.match(/[A-Za-z_$][\w$]*/g) ?? []);
  return { dialects: fileDialects(specs, fileText), fileText, tokens, fileTouches: touches({ fileText, changedText: fileText, lang }) };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does the file use this issue symbol *as the package's API*? A deep import path anywhere; a member or pair
 * used on one of the package's bindings; or an option / keyword argument (`{ audience: … }`, `log_scale=True`).
 * A variable that merely shares a name with the issue's repro (`jwtSecret`, `attention_norm`) does not count.
 */
function usesAsApi(name: string, ctx: MatchContext): boolean {
  const text = ctx.fileText ?? '';
  if (name.includes('/')) return text.includes(name);
  const t = ctx.fileTouch;
  if (name.includes('.')) return Boolean(t?.pairs.includes(name) || t?.specifiers.includes(name));
  if (t?.symbols.includes(name)) return true;
  return new RegExp(`[({,]\\s*['"]?${escapeRe(name)}['"]?\\s*[:=](?!=)`).test(text);
}

/** The first issue symbol, other than the matched one, that the file also contains and that says something specific. */
export function corroboration(l: Landmine, primary: string, ctx: MatchContext): string | undefined {
  if (!ctx.tokens || ctx.fileText === undefined) return undefined;
  const primaryParts = new Set(primary.split(/[./]/));
  // The title says what the issue is about: unless a driver path corroborates, the matched symbol or the
  // corroborator must be named there (`Series` + `DataFrame` shown in an adbc bug's repro does not qualify).
  const primaryInTitle = l.symbols.some((s) => s.name === primary && s.sources.includes('title'));
  const roots = new Set([l.package, l.package.split('/').at(-1) ?? '', ...(ctx.packageRoots ?? [])].map((r) => r.toLowerCase()));
  for (const s of l.symbols) {
    if (s.name === primary) continue;
    const parts = s.name.split(/[./]/).filter(Boolean);
    const isPath = s.name.includes('/');
    // An import path corroborates only when it picks a variant (a driver: `drizzle-orm/node-postgres`); a plugin
    // path (`dayjs/plugin/timezone`) is just what you need to use the matched API at all.
    if (isPath && !parts.slice(1).some((p) => isDialectWord(p))) continue;
    // Anything else must be a symbol the issue is specifically about, not a penalized entry point (`DataFrame`).
    if (!isPath && s.score < 0.5) continue;
    // Driver/module import paths count wherever they were seen; any other corroborator must be something the
    // author named in prose (title or inline code). Repro-only names are often their own variables (`jwtSecret`).
    if (!isPath && !s.sources.some((src) => src === 'title' || src === 'span')) continue;
    // Must add something beyond the primary symbol: not the package's own name, a generic word or a short name.
    const novel = parts.filter((p) => !primaryParts.has(p) && !roots.has(p.toLowerCase()) && p.length >= 4 && !GENERIC.has(p.toLowerCase()));
    if (novel.length === 0) continue;
    if (!isPath && !primaryInTitle && !s.sources.includes('title')) continue;
    if (usesAsApi(s.name, ctx)) return s.name;
  }
  return undefined;
}

/** Landmines whose strong symbols the edit touches, best first, one hit per issue. */
export function matchTouches(found: Touch[], index: LandmineIndex, lang: Lang, ctx: MatchContext = {}): Hit[] {
  const best = new Map<string, Hit>();
  for (const touch of found) {
    const keys = packagesFor(touch, lang, index);
    if (keys.size === 0) continue;
    const names = [...touch.specifiers, ...touch.pairs, ...touch.symbols];
    // `dayjs/plugin/customParseFormat` is what issues call `CustomParseFormat`.
    const segments = new Set(touch.specifiers.map((s) => (s.split('/').at(-1) ?? '').toLowerCase()).filter((s) => s.length >= 6));
    for (const l of index.landmines) {
      if (!keys.has(`${l.ecosystem}:${l.package}@${l.version}`) || l.evidence.strength === 'weak' || l.nonBug) continue;
      // A MySQL-only bug is not a landmine in a file that talks to Postgres.
      if (l.dialects?.length && ctx.dialects?.size && !l.dialects.some((d) => ctx.dialects?.has(d))) continue;
      let hit: { symbol: string; score: number } | undefined;
      for (const name of names) {
        const s = l.symbols.find((x) => x.name === name);
        if (s && s.score >= SYMBOL_THRESHOLD && (!hit || s.score > hit.score)) hit = { symbol: name, score: s.score };
      }
      for (const s of l.symbols) {
        if (s.score >= SYMBOL_THRESHOLD && segments.has(s.name.toLowerCase()) && (!hit || s.score > hit.score)) hit = { symbol: s.name, score: s.score };
      }
      if (!hit) continue;
      const pkg = index.packages.find((p) => p.ecosystem === l.ecosystem && p.name === l.package && p.version === l.version);
      const fileTouch = ctx.fileTouches?.find((t) => t.package === touch.package);
      const corroboratedBy = corroboration(l, hit.symbol, { ...ctx, packageRoots: pkg?.importNames ?? [], ...(fileTouch ? { fileTouch } : {}) });
      const rank = hit.score * STRENGTH_WEIGHT[l.evidence.strength] * (1 + Math.log10(1 + l.issue.reactions)) * (corroboratedBy ? 2 : 1);
      const prev = best.get(l.id);
      if (!prev || rank > prev.rank) best.set(l.id, { landmine: l, symbol: hit.symbol, score: hit.score, rank, ...(corroboratedBy ? { corroboratedBy } : {}) });
    }
  }
  return [...best.values()].sort((a, b) => b.rank - a.rank || a.landmine.issue.number - b.landmine.issue.number);
}

/** Match a whole file (as if every line were new). */
export function checkFile(path: string, index: LandmineIndex, text: string = readFileSync(path, 'utf8')): Hit[] {
  const lang = langForPath(path);
  if (!lang) return [];
  return matchTouches(touches({ fileText: text, changedText: text, lang }), index, lang, fileContext(text, lang));
}
