import type { RawIssue } from '../github/issues.js';
import type { MentionKind, Strength, VersionEvidence } from '../types.js';
import { stripNoise } from './markdown.js';

export interface Mention {
  index: number;
  length: number;
  kind: MentionKind;
  /** The text attributes this version to a different product (`drizzle-kit`, `macOS`, `Node.js`). */
  other: boolean;
  affected: boolean;
  /** For comments: does the surrounding text say the problem happens? */
  confirmed: boolean;
  quote: string;
}

export interface PackageContext {
  name: string;
  version: string;
  repo: string;
  repoDirectory?: string;
  /** PyPI import names (`sklearn` for scikit-learn): what show_versions-style dumps call the package. */
  importNames?: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Names people use for the package in prose: `@tanstack/react-query`, `react-query`, `query`. */
export function packageAliases(ctx: Pick<PackageContext, 'name' | 'repo' | 'importNames'>): string[] {
  const tail = ctx.name.includes('/') ? (ctx.name.split('/')[1] ?? ctx.name) : ctx.name;
  const repoName = ctx.repo.split('/')[1] ?? '';
  const names = new Set([ctx.name, tail, repoName, repoName.replace(/\.js$/i, ''), repoName.replace(/[-_.]?js$/i, ''), ...(ctx.importNames ?? [])]);
  return [...names].filter((n) => n.length >= 2);
}

const NEGATION = /\b(not|never|no longer|stopped|cannot)\b|n't\b/i;
const WORKAROUND_CONTEXT = /work[- ]?around|fix|patch|solution|suggest|hack/i;
const WORKS_CUE =
  /\b(works?|worked|working|pass(?:es|ed|ing)?)\b(?:\s+(?:fine|correctly|well|ok|okay|as expected|perfectly|again|for me))?\s+(?:in|on|with|at|using|under|for)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const GOOD_CUE = /\b(fine|ok|okay|good|correct(?:ly)?|as expected|no issues?|no problems?)\s+(?:in|on|with|at|using|under)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const ROLLBACK_CUE =
  /\b(downgrad\w*|revert\w*|roll(?:ed|ing)?\s*back|go(?:ing)?\s+back|went\s+back|pin(?:ned|ning)?)\b(?:\s+\S+){0,2}?\s+(?:to|at)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const LAST_GOOD_CUE = /\blast\s+(?:known\s+)?(?:good|working|stable)\s*(?:version)?\s*(?:is|was|:|=)?\s*(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const FIXED_CUE = /\b(fixed|resolved|released|available|landed|shipped|patched|solved|addressed)\s+(?:in|with|by|on|as of|since)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const FROM_CUE = /\bfrom\s+(?:\S+\s+)?(?:version\s*|v\s*)?\(?$/i;
const MIGRATION = /\b(upgrad|updat|migrat|bump|mov(?:ed|ing)|switch)\w*/i;
const POST_UNAFFECTED =
  /^[\s`'"*)\]]*[,;:]?\s*(?:and\s+|which\s+|that\s+|it\s+|where\s+it\s+)?(?:does(?:n't| not)\s+(?:have|experience|reproduce|show|exhibit|suffer|happen|occur)|(?:is|was)\s+(?:fine|ok|okay|unaffected|not affected|working fine)|works\s+(?:fine|correctly|well|as expected|ok)|is(?:n't| not) affected|has no (?:such )?(?:issue|problem|bug))/i;
/** Later in the same sentence: "Using 2.2.3, the snippet works just fine", "On 2.2.3 I can't reproduce". */
const SENTENCE_UNAFFECTED =
  /\b(works?\s+(?:just\s+)?(?:fine|correctly|as expected|well|perfectly)|(?:seems|appears)\s+(?:to\s+(?:be|have\s+been)\s+)?(?:fixed|resolved)|(?:is|was|has been)\s+(?:already\s+)?(?:fixed|resolved)|fixed already|(?:can'?t|cannot|could\s*n[o']t|unable to|failed to)\s+reproduce|no longer\s+(?:happens|occurs|reproduces|an issue|a problem)|not reproducible)\b/i;
const STATUS_QUESTION =
  /\b(moot|(?:is|was|has)\s+(?:this|it)\s+(?:been\s+)?(?:still|now|already|fixed|resolved|addressed)|(?:fixed|resolved|addressed)\s+(?:in|by|with)|does\s+(?:this|it)\s+still)\b/i;
const CONFIRM = /\b(still|same|also|as well|too|facing|face|experienc\w*|encounter\w*|reproduc\w*|repro|confirm\w*|happen\w*|broken|break\w*|issue|bug|error|problem|fail\w*|crash\w*|occur\w*|present|persist\w*|affect\w*|seeing|getting)\b/i;
const TEMPLATE_WORD = /\bversions?\b/i;
const OTHER_PRODUCT = /\b(os|macos|mac ?os x?|windows|win|ubuntu|debian|linux|ios|ipados|android|node(?:\.?js)?|python|npm|pnpm|yarn|bun|deno|chrome|chromium|firefox|safari|edge|browser|typescript|tsc|kernel|xcode|java|jdk|golang|rustc|docker|postgres(?:ql)?|mysql|sqlite|redis|electron|expo|react native)\b/i;

/** Does this label (template question, `X version:` prefix) name some other product rather than ours? */
function namesOtherProduct(label: string, aliases: string[]): boolean {
  const lower = label.toLowerCase();
  if (aliases.some((a) => new RegExp(`(?<![\\w@/-])${escapeRe(a)}(?![\\w-])`).test(lower))) return false;
  const named = [...label.matchAll(/`([^`]+)`/g)]
    .map((m) => (m[1] ?? '').toLowerCase())
    .filter((n) => /^@?[a-z][\w.@/-]*$/.test(n) && !/^v?\d/.test(n));
  if (named.some((n) => !aliases.includes(n))) return true;
  if (/(?<![\w@])(?:@[\w.-]+\/)?[a-z][\w.]*-[\w.-]+/i.test(label)) return true;
  return OTHER_PRODUCT.test(label);
}

/** Words that commonly sit right before a version and are not product names. */
const NOT_A_NAME = new Set(
  `on in with at to from for of by is was are be been and or but as using use used uses run running ran version versions release released tag tagged
  latest current currently now still also both since until before after upgraded upgrading upgrade updated updating update tested test testing installed
  install pinned pin bumped bump downgraded downgrade see saw get got getting have has had my our the a an this that its it i we you they when where
  which what v ver vs versus than like even only just exactly here there then not no yes ok works worked working fails failed failing broken happens
  happening occurs issue bug error problem same environment env between through into via per against within without is version: release: tested:`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * The name written right before the version, when there is one: `"@types/jsonwebtoken": "^9.0.2"`, `amqp==5.4.0`,
 * `matplotlib: 2.2.3`, `Compiling rayon v1.11.0`. Undefined when the text before is prose.
 */
export function nameBefore(before: string): string | undefined {
  const tail = before.slice(-60);
  const json = /["']([@\w./-]+)["']\s*:\s*["']?\s*[\^~>=<]*\s*$/.exec(tail);
  if (json?.[1]) return json[1];
  const pin = /([A-Za-z][\w.-]*(?:\[[^\]]*\])?)\s*(?:===?|>=|<=|~=|@)\s*$/.exec(tail);
  if (pin?.[1]) return pin[1].replace(/\[.*$/, '');
  const spaced = /(?:^|[\s(|,;])([@A-Za-z][\w.@/-]*)\s*(?::\s*|\s+)$/.exec(tail);
  if (spaced?.[1]) return spaced[1];
  return undefined;
}

/** Every mention of `version` (or `v<version>`) in `text`, classified. */
export function findMentions(text: string, ctx: Pick<PackageContext, 'name' | 'version' | 'repo' | 'importNames'>): Mention[] {
  // `2.5.0+cu124` (PEP 440 local version) and `1.0.0+build.5` (semver build metadata) are the same release;
  // `2.5.0.dev20240708`, `2.5.0rc1`, `2.5.0-beta.1` are not.
  const re = new RegExp(
    `(?<![\\w.+\\-])v?${escapeRe(ctx.version)}(?![\\w]|\\.\\d|-\\w|\\.(?:dev|post|a|b|rc|alpha|beta|pre|next|canary)\\w*)`,
    'gi',
  );
  const aliases = packageAliases(ctx).map((a) => a.toLowerCase());
  const mentions: Mention[] = [];
  for (const m of text.matchAll(re)) {
    // Everything below looks at most WINDOW characters around the mention, so cost is linear in the
    // number of mentions, and a dump with thousands of them stops at MAX_MENTIONS.
    if (mentions.length >= MAX_MENTIONS) break;
    const index = m.index ?? 0;
    const end = index + m[0].length;
    const back = text.slice(Math.max(0, index - WINDOW), index);
    const nl = back.lastIndexOf('\n');
    const lineStart = nl >= 0 ? index - back.length + nl + 1 : Math.max(0, index - WINDOW);
    const fwd = text.slice(end, end + WINDOW);
    const fwdNl = fwd.indexOf('\n');
    const lineEnd = fwdNl >= 0 ? end + fwdNl : Math.min(text.length, end + WINDOW);
    const line = text.slice(lineStart, lineEnd);
    const before = text.slice(lineStart, index);
    const sentenceStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
    const pre = before.slice(sentenceStart + 1).slice(-80);
    const post = text.slice(end, Math.min(lineEnd, end + 60));
    let t = before.length;
    while (t > 0 && !/\s/.test(before[t - 1] ?? ' ')) t--;
    const token = before.slice(t);

    let kind: MentionKind = 'plain';
    if (/:\/\/|www\.|[\w-]+\.(?:com|org|net|io|dev|sh|app)\//i.test(token)) kind = 'url';
    else if (/(\^|~|>=?|<=?)\s*["'`]?$/.test(before.slice(-3)) || /^\s*(?:\.x|\s*-\s*\d)/.test(post)) kind = 'range';
    else if (aliases.some((a) => new RegExp(`(?<![\\w@/-])${escapeRe(a)}(?![\\w-])`).test(before.slice(-30).toLowerCase()))) kind = 'adjacent';
    else if (TEMPLATE_WORD.test(before.slice(-40)) || isTemplateValue(text, lineStart, line)) kind = 'template';

    let affected = true;
    const cues = [WORKS_CUE, GOOD_CUE, ROLLBACK_CUE, LAST_GOOD_CUE, FIXED_CUE];
    for (const cue of cues) {
      const c = cue.exec(pre);
      if (!c) continue;
      // "doesn't work with X", "not fixed in X": negated cues mean X is affected.
      const cueSpan = pre.slice(Math.max(0, c.index - 15), c.index + c[0].length);
      if (NEGATION.test(cueSpan)) continue;
      if (cue === WORKS_CUE && WORKAROUND_CONTEXT.test(pre)) continue;
      affected = false;
      break;
    }
    if (affected && FROM_CUE.test(pre) && MIGRATION.test(line)) affected = false;
    if (affected && POST_UNAFFECTED.test(post)) affected = false;
    const sentenceEnd = fwd.search(/[.!?](?:\s|$)|\n[ \t]*\n/);
    const rest = text.slice(end, sentenceEnd < 0 ? Math.min(text.length, end + 160) : end + sentenceEnd);
    if (affected && SENTENCE_UNAFFECTED.test(rest.slice(0, 160)) && !NEGATION.test(rest.slice(0, rest.search(SENTENCE_UNAFFECTED)))) affected = false;

    const window = text.slice(Math.max(0, index - 120), Math.min(text.length, end + 120));
    // "Is this issue now moot with 6.0.2?" asks about status; "still facing this in 0.36.0?" still confirms.
    const sentence = `${pre}${text.slice(index, end)}${text.slice(end, end + 200).split(/[.!\n]/)[0] ?? ''}`;
    const question = /\?/.test(sentence) && STATUS_QUESTION.test(sentence);
    let quote = line.trim();
    let other = false;
    // A different package's version that happens to be the same string.
    const named = nameBefore(before)?.toLowerCase();
    if (named && !NOT_A_NAME.has(named) && !aliases.some((a) => named === a || named === `${a}.js` || named === `${a}js`)) other = true;
    // One entry in a comma-separated run of versions ("from versions: 1.22.0, 1.22.1, …"). Environment
    // dumps (`PyTorch version: 2.5.0`, `numpy 1.26.4` lines) are dense with versions too, but are not lists.
    if (inVersionList(before.slice(-80), text.slice(end, end + 80))) other = true;
    if (kind === 'template') {
      const sameLine = before.slice(-40);
      const prevLabel = text.slice(Math.max(0, lineStart - 400), lineStart).split('\n').filter((l) => l.trim()).at(-1);
      const label = TEMPLATE_WORD.test(sameLine) ? sameLine : prevLabel && TEMPLATE_WORD.test(prevLabel) ? prevLabel : '';
      if (label && namesOtherProduct(label, aliases)) other = true;
      if (label === prevLabel && quote.length <= 40) quote = `${label.replace(/^[#\s*|-]+|[\s*|]+$/g, '')} ${quote}`;
    } else if (kind === 'plain' && namesOtherProduct(before.slice(-25), aliases) && OTHER_PRODUCT.test(before.slice(-25))) {
      other = true;
    }
    mentions.push({
      index,
      length: m[0].length,
      kind,
      other,
      affected,
      confirmed: CONFIRM.test(window) && !question,
      quote: quote.replace(/\s+/g, ' ').slice(0, 160),
    });
  }
  return mentions;
}

const WINDOW = 400;
const MAX_MENTIONS = 200;
const VERSIONISH = /^v?\d+(?:\.\d+)+[\w.+-]*$/;

/** Is the mention one entry of a comma-separated run of versions? Split-based, so no regex backtracking. */
export function inVersionList(before: string, after: string): boolean {
  const prev = before.split(',');
  const listBefore = prev.length >= 3 && (prev.at(-1) ?? 'x').trim() === '' && prev.slice(-3, -1).every((p) => VERSIONISH.test(p.trim().split(/\s+/).at(-1) ?? ''));
  const next = after.split(',');
  const listAfter = next.length >= 3 && (next[0] ?? 'x').trim() === '' && next.slice(1, 3).every((p) => VERSIONISH.test(p.trim().split(/\s+/)[0] ?? ''));
  return listBefore || listAfter;
}

/** `### Version\n\n3.6.0` style: the value sits alone on a short line under a heading/label that says "version". */
function isTemplateValue(text: string, lineStart: number, line: string): boolean {
  if (line.trim().length > 40) return false;
  const prevLines = text.slice(Math.max(0, lineStart - 400), lineStart).split('\n').filter((l) => l.trim());
  return prevLines.slice(-3).some((l) => TEMPLATE_WORD.test(l));
}

const RANK: Record<Strength, number> = { weak: 0, medium: 1, strong: 2 };
const BY_RANK: Strength[] = ['weak', 'medium', 'strong'];

export function downgrade(s: Strength): Strength {
  return BY_RANK[Math.max(0, RANK[s] - 1)] ?? 'weak';
}

export function strengthRank(s: Strength): number {
  return RANK[s];
}

/** Versions like 1.0.0, 2.0.0, 0.3.0 show up for unrelated tools; plain mentions of them are weak. */
function isCommonVersion(v: string): boolean {
  return /^\d+\.0\.0$/.test(v) || /^0\.\d+\.0$/.test(v);
}

const NEGATIVE_LABEL = /can'?t[- ]?reproduce|cannot[- ]reproduce|unable to reproduce|invalid|wontfix|won't fix|not a bug|works as (?:intended|expected)|duplicate|question|needs[- ]repro/i;
const SEMVERISH = /(?<![\w.])v?\d+\.\d+(?:\.\d+)?(?:[-.][\w.]+)?(?![\w])/g;

/**
 * Why a search hit is not a landmine:
 * - unverified: the version string is nowhere in the fetched text (GitHub search noise)
 * - unaffected: it is only named as working, fixed, or the version someone upgraded from
 * - incidental: it only appears in URLs or hidden comments
 */
export type DropReason = 'unverified' | 'unaffected' | 'incidental';
export type EvidenceResult = { evidence: VersionEvidence } | { dropped: DropReason };

/** Decide whether an issue was filed against (or confirmed on) exactly `ctx.version`. */
export function versionEvidence(issue: RawIssue, ctx: PackageContext): EvidenceResult {
  const titleMentions = findMentions(issue.title, ctx);
  const body = stripNoise(issue.body);
  const bodyMentions = findMentions(body, ctx);
  const author = [...titleMentions.map((m) => ({ m, where: 'title' as const })), ...bodyMentions.map((m) => ({ m, where: 'body' as const }))];
  const notes: string[] = [];

  let evidence: VersionEvidence | undefined;
  const authorAffected = author.filter((a) => a.m.affected && a.m.kind !== 'url' && !a.m.other);
  if (authorAffected.length > 0) {
    const order: MentionKind[] = ['template', 'adjacent', 'range', 'plain'];
    authorAffected.sort((a, b) => order.indexOf(a.m.kind) - order.indexOf(b.m.kind));
    const best = authorAffected[0];
    if (best) {
      let strength: Strength = best.m.kind === 'template' || best.m.kind === 'adjacent' || best.where === 'title' ? 'strong' : 'medium';
      if (best.m.kind === 'range') strength = 'medium';
      if (best.m.kind === 'plain' && isCommonVersion(ctx.version)) {
        strength = 'weak';
        notes.push('common version number');
      }
      const otherInTitle = [...issue.title.matchAll(SEMVERISH)].some((v) => v[0].replace(/^v/, '') !== ctx.version);
      if (best.m.kind === 'plain' && best.where === 'body' && otherInTitle && titleMentions.length === 0) {
        strength = 'weak';
        notes.push('title is about a different version');
      }
      evidence = { strength, where: best.where, kind: best.m.kind, quote: best.m.quote };
    }
  }

  if (!evidence) {
    for (const c of issue.comments) {
      if (c.minimized) continue;
      const cm = findMentions(stripNoise(c.body), ctx).filter((m) => m.affected && m.kind !== 'url' && !m.other);
      const best = cm.find((m) => m.confirmed && m.kind !== 'range') ?? cm.find((m) => m.confirmed) ?? cm[0];
      if (!best) continue;
      const strength: Strength = best.confirmed ? (best.kind === 'range' ? 'weak' : 'medium') : 'weak';
      if (!evidence || strengthRank(strength) > strengthRank(evidence.strength)) {
        evidence = { strength, where: 'comment', kind: best.kind, quote: best.quote, by: c.author };
      }
      if (evidence.strength === 'medium') break;
    }
  }

  if (!evidence) {
    const visible = [...author.map((a) => a.m), ...issue.comments.filter((c) => !c.minimized).flatMap((c) => findMentions(stripNoise(c.body), ctx))];
    if (visible.some((m) => !m.affected && m.kind !== 'url' && !m.other)) return { dropped: 'unaffected' };
    const anyMention = visible.length > 0 || issue.comments.some((c) => findMentions(c.body, ctx).length > 0);
    return { dropped: anyMention ? 'incidental' : 'unverified' };
  }

  const monorepo = Boolean(ctx.repoDirectory) || !packageAliases({ name: ctx.name, repo: ctx.repo }).slice(0, 2).some((a) => ctx.repo.toLowerCase().endsWith(`/${a.toLowerCase()}`));
  if (monorepo) {
    const text = `${issue.title}\n${issue.body}\n${issue.labels.join(' ')}`.toLowerCase();
    const named = packageAliases({ name: ctx.name, repo: '' }).some((a) => new RegExp(`(?<![\\w-])${escapeRe(a.toLowerCase())}(?![\\w-])`).test(text));
    if (!named) {
      evidence.strength = downgrade(evidence.strength);
      notes.push(`monorepo issue that never names ${ctx.name}`);
    }
  }
  if (issue.labels.some((l) => NEGATIVE_LABEL.test(l))) {
    evidence.strength = downgrade(evidence.strength);
    notes.push(`labelled ${issue.labels.filter((l) => NEGATIVE_LABEL.test(l)).join(', ')}`);
  }
  if (notes.length) evidence.notes = notes;
  return { evidence };
}
