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
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Names people use for the package in prose: `@tanstack/react-query`, `react-query`, `query`. */
export function packageAliases(ctx: Pick<PackageContext, 'name' | 'repo'>): string[] {
  const tail = ctx.name.includes('/') ? (ctx.name.split('/')[1] ?? ctx.name) : ctx.name;
  const repoName = ctx.repo.split('/')[1] ?? '';
  const names = new Set([ctx.name, tail, repoName, repoName.replace(/\.js$/i, ''), repoName.replace(/[-_.]?js$/i, '')]);
  return [...names].filter((n) => n.length >= 2);
}

const NEGATION = /\b(not|never|no longer|stopped|cannot)\b|n't\b/i;
const WORKAROUND_CONTEXT = /work[- ]?around|fix|patch|solution|suggest|hack/i;
const WORKS_CUE =
  /\b(works?|worked|working)\b(?:\s+(?:fine|correctly|well|ok|okay|as expected|perfectly|again|for me))?\s+(?:in|on|with|at|using|under|for)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const GOOD_CUE = /\b(fine|ok|okay|good|correct(?:ly)?|as expected|no issues?|no problems?)\s+(?:in|on|with|at|using|under)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const ROLLBACK_CUE =
  /\b(downgrad\w*|revert\w*|roll(?:ed|ing)?\s*back|go(?:ing)?\s+back|went\s+back|pin(?:ned|ning)?)\b(?:\s+\S+){0,2}?\s+(?:to|at)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const LAST_GOOD_CUE = /\blast\s+(?:known\s+)?(?:good|working|stable)\s*(?:version)?\s*(?:is|was|:|=)?\s*(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const FIXED_CUE = /\b(fixed|resolved|released|available|landed|shipped|patched|solved|addressed)\s+(?:in|with|by|on|as of|since)\s+(?:\S+\s+)?(?:version\s*|v\s*)?$/i;
const FROM_CUE = /\bfrom\s+(?:\S+\s+)?(?:version\s*|v\s*)?\(?$/i;
const MIGRATION = /\b(upgrad|updat|migrat|bump|mov(?:ed|ing)|switch)\w*/i;
const POST_UNAFFECTED =
  /^[\s`'"*)\]]*[,;:]?\s*(?:and\s+|which\s+|that\s+|it\s+|where\s+it\s+)?(?:does(?:n't| not)\s+(?:have|experience|reproduce|show|exhibit|suffer|happen|occur)|(?:is|was)\s+(?:fine|ok|okay|unaffected|not affected|working fine)|works\s+(?:fine|correctly|well|as expected|ok)|is(?:n't| not) affected|has no (?:such )?(?:issue|problem|bug))/i;
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

/** Every mention of `version` (or `v<version>`) in `text`, classified. */
export function findMentions(text: string, ctx: Pick<PackageContext, 'name' | 'version' | 'repo'>): Mention[] {
  const re = new RegExp(`(?<![\\w.+\\-])v?${escapeRe(ctx.version)}(?![\\w]|\\.\\d|-\\w|\\+\\w)`, 'gi');
  const aliases = packageAliases(ctx).map((a) => a.toLowerCase());
  const mentions: Mention[] = [];
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const lineEndRaw = text.indexOf('\n', end);
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    const line = text.slice(lineStart, lineEnd);
    const before = text.slice(lineStart, index);
    const sentenceStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
    const pre = before.slice(sentenceStart + 1).slice(-80);
    const post = text.slice(end, Math.min(lineEnd, end + 60));
    const token = before.slice(before.search(/\S*$/));

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

    const window = text.slice(Math.max(0, index - 120), Math.min(text.length, end + 120));
    let quote = line.trim();
    let other = false;
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
      confirmed: CONFIRM.test(window),
      quote: quote.replace(/\s+/g, ' ').slice(0, 160),
    });
  }
  return mentions;
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
