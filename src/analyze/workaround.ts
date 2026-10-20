import type { RawComment, RawIssue } from '../github/issues.js';
import type { FixHint, Workaround } from '../types.js';
import { dropQuotes, splitFences, stripNoise } from './markdown.js';

/** "Any workaround?" asks for one; "Our workaround is…" offers one. */
export function offersWorkaround(text: string): boolean {
  for (const m of text.matchAll(/\bwork(?:ed)?[- ]?arounds?\b/gi)) {
    const i = m.index ?? 0;
    const start = Math.max(text.lastIndexOf('.', i), text.lastIndexOf('\n', i), text.lastIndexOf('?', i - 1), text.lastIndexOf('!', i)) + 1;
    const ends = [text.indexOf('.', i), text.indexOf('\n', i), text.indexOf('?', i), text.indexOf('!', i)].filter((x) => x >= 0);
    const end = ends.length ? Math.min(...ends) : text.length;
    if (text[end] === '?') continue;
    const before = text.slice(Math.max(start, i - 30), i);
    if (/\b(any|no|without|is there|are there|anyone|someone|need(ed)?|looking for|find|found|know of|have a|a good|possible)\s+(\w+\s+)?$/i.test(before)) continue;
    return true;
  }
  return false;
}

/** Phrases that claim a fix or a way around the bug (+3, once). */
const KEYWORDS: Array<[RegExp | ((text: string) => boolean), string]> = [
  [offersWorkaround, 'says workaround'],
  [/\b(temporary|temp|quick|interim)\s+(fix|solution)\b/i, 'temporary fix'],
  [/\b(fixed|solved|resolved|got around|worked around) (it|this|the issue|the problem)? ?by\b/i, 'fixed it by'],
  [/\bwhat (worked|works) for me\b|\bthis (worked|works) for (me|us)\b|\bit (actually )?works\b|\bthat did the trick\b|\bworks? (fine |perfectly )?now\b/i, 'reports it worked'],
  [/\byou can (use|pass|set|add|wrap|call|override|disable|enable|import|replace|cast|downgrade|pin|avoid|just)\b/i, 'suggests an alternative'],
  [/\b(use|call|try|switch to)\b[^.\n?]{1,60}\binstead\b|\binstead of [^.,\n?]{1,40}, (use|try|call)\b/i, 'suggests an alternative'],
  [/\btry (this|using|adding|setting|passing|removing)\b|\b(the )?(solution|fix) (is|was|for me)\b|\bsolution:|^#{1,4}\s*(solution|workaround|fix)\b|\b(found|have) a (solution|fix|way)\b/im, 'suggests a fix'],
  [/\b(downgrad\w*|pin\w*|roll(ed|ing)? back) to\b/i, 'suggests pinning a version'],
  [/\bpatch-package\b|\bpnpm patch\b|\byarn patch\b/i, 'patches the dependency'],
];

/** Weaker hints that a reply contains a way around the bug (+1 each). */
const HINTS: Array<[RegExp, string]> = [
  [/@ts-(expect-error|ignore)|\bas any\b|# type: ignore/i, 'type escape hatch'],
  [/\bmonkey[- ]?patch\w*\b/i, 'monkey patch'],
  [/"(overrides|resolutions)"\s*:/i, 'dependency override'],
];

const NOISE = /^\s*(\+1|same( here| issue)?|same problem|any (update|news|progress)s?\??|bump|me too|following|subscribed?|same for me)[\s.!]*$/i;
const MAINTAINER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const SAFE_HOSTS =
  /^(?:[\w-]+\.)*(github\.com|githubusercontent\.com|npmjs\.com|pypi\.org|stackblitz\.com|codesandbox\.io|stackoverflow\.com|mozilla\.org|nodejs\.org|python\.org|typescriptlang\.org)$/i;

interface Candidate {
  author: string;
  association: string;
  url: string;
  createdAt: string;
  reactions: number;
  body: string;
  fromIssueBody: boolean;
}

function normalized(body: string): string {
  return body.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Comment bodies repeated across ≥3 issues of one package (maintainer batch messages, bots). */
export function boilerplateBodies(issues: RawIssue[]): Set<string> {
  const counts = new Map<string, number>();
  for (const i of issues) {
    const seen = new Set<string>();
    for (const c of i.comments) {
      const n = normalized(c.body);
      if (n.length < 40 || seen.has(n)) continue;
      seen.add(n);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, n]) => n >= 3).map(([b]) => b));
}

function scoreCandidate(c: Candidate, boosted: Set<string>): { score: number; signals: string[]; keyword: boolean } {
  const text = dropQuotes(stripNoise(c.body));
  const signals: string[] = [];
  let score = 0;
  let keyword = false;
  for (const [re, label] of KEYWORDS) {
    if (typeof re === 'function' ? re(text) : re.test(text)) {
      if (!keyword) score += 3;
      keyword = true;
      if (!signals.includes(label)) signals.push(label);
    }
  }
  for (const [re, label] of HINTS) {
    if (re.test(text)) {
      score += 1;
      signals.push(label);
    }
  }
  const { prose, fences } = splitFences(text);
  if (fences.length > 0) {
    score += 2;
    signals.push('has code');
  } else if (/`[^`\n]+`/.test(prose)) score += 1;
  if (c.reactions > 0) {
    score += 1.5 * Math.log2(1 + c.reactions);
    signals.push(`${c.reactions} reaction${c.reactions === 1 ? '' : 's'}`);
  }
  if (MAINTAINER.has(c.association)) {
    score += 1;
    signals.push(`by a ${c.association.toLowerCase()}`);
  }
  if (!c.fromIssueBody && boosted.has(c.author)) {
    score += 3;
    signals.push('credited by another commenter');
  }
  const plain = prose.replace(/\s+/g, ' ').trim();
  if (fences.length === 0 && plain.length < 60) score -= 3;
  if (NOISE.test(plain)) score -= 3;
  // The reporter's own text only counts when it literally offers a workaround.
  if (c.fromIssueBody && !offersWorkaround(text)) score = -Infinity;
  // Code + upvotes with no claim of a fix is often a diagnosis; require real support for it.
  if (!keyword && !(fences.length > 0 && c.reactions >= 3)) score = -Infinity;
  return { score, signals, keyword };
}

/** Clean text for quoting to a model: no HTML, no quoted replies, bounded length. */
export function excerpt(body: string, max = 700): string {
  const text = dropQuotes(stripNoise(body))
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= max) return text;
  const fenceStart = text.indexOf('```');
  if (fenceStart >= 0 && fenceStart < max) {
    const fenceEnd = text.indexOf('```', fenceStart + 3);
    if (fenceEnd > 0 && fenceEnd + 3 <= max + 400) return `${text.slice(0, fenceEnd + 3).trim()}\n…`;
  }
  const cut = text.slice(0, max);
  const fences = (cut.match(/```/g) ?? []).length;
  return `${cut.replace(/\s+\S*$/, '')}${fences % 2 === 1 ? '\n```' : ''}\n…`;
}

/** Commands or links in a quote that a model should not run or follow blindly. */
export function caution(text: string, packageName: string): string | undefined {
  const reasons: string[] = [];
  if (/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i.test(text)) reasons.push('pipes a download into a shell');
  for (const m of text.matchAll(/\b(?:npm\s+(?:i|install|add)|pnpm\s+add|yarn\s+add|bun\s+add|pip3?\s+install|uv\s+(?:pip\s+install|add))\s+((?:-[-\w]+\s+)*)([@\w./:-]+)/gi)) {
    const pkg = (m[2] ?? '').replace(/@[\d^~<>=.*x-]+$/, '');
    if (pkg && pkg.toLowerCase() !== packageName.toLowerCase() && !pkg.startsWith('-')) {
      reasons.push(`installs another package (${pkg})`);
      break;
    }
  }
  const hosts = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/([^/\s)>\]"']+)/gi)) {
    const host = m[1]?.toLowerCase() ?? '';
    if (host && !SAFE_HOSTS.test(host)) hosts.add(host);
  }
  if (hosts.size) reasons.push(`links to ${[...hosts].slice(0, 3).join(', ')}`);
  return reasons.length ? `${reasons.join('; ')}: verify before running` : undefined;
}

/** The comment (or issue body) most likely to contain a working workaround. */
export function pickWorkaround(issue: RawIssue, packageName: string, boilerplate: Set<string> = new Set()): Workaround | undefined {
  const comments = issue.comments.filter((c) => !c.minimized && !boilerplate.has(normalized(c.body)) && !/\[bot\]$|^github-actions$/i.test(c.author));
  const boosted = new Set<string>();
  for (const c of comments) {
    for (const m of c.body.matchAll(/@([\w-]+)['’]?s?\s+(?:\w+\s+){0,3}?(work[- ]?around|fix|solution|suggestion|answer|approach|patch|trick)/gi)) {
      if (m[1] && m[1] !== c.author) boosted.add(m[1]);
    }
  }
  const candidates: Candidate[] = [
    {
      author: issue.author,
      association: issue.association,
      url: issue.url,
      createdAt: issue.createdAt,
      reactions: 0,
      body: issue.body,
      fromIssueBody: true,
    },
    ...comments.map((c: RawComment) => ({
      author: c.author,
      association: c.association,
      url: c.url,
      createdAt: c.createdAt,
      reactions: c.positiveReactions,
      body: c.body,
      fromIssueBody: false,
    })),
  ];
  let best: { c: Candidate; score: number; signals: string[]; keyword: boolean } | undefined;
  for (const c of candidates) {
    const scored = scoreCandidate(c, boosted);
    if (scored.score >= 4 && (!best || scored.score > best.score)) best = { c, ...scored };
  }
  if (!best) return undefined;
  const text = best.c.fromIssueBody ? workaroundSection(best.c.body) : best.c.body;
  const ex = excerpt(text);
  const warn = caution(ex, packageName);
  return {
    kind: best.keyword ? 'workaround' : 'top-reply',
    author: best.c.author,
    association: best.c.association,
    url: best.c.url,
    createdAt: best.c.createdAt,
    reactions: best.c.reactions,
    excerpt: ex,
    signals: best.signals,
    ...(warn ? { caution: warn } : {}),
  };
}

/** For an issue body, quote from the workaround mention onward rather than the whole report. */
function workaroundSection(body: string): string {
  const idx = body.search(/work[- ]?around/i);
  if (idx < 0) return body;
  const lineStart = body.lastIndexOf('\n', idx) + 1;
  return body.slice(lineStart);
}

const FIX_RE =
  /\b(?:fixed|resolved|released|landed|available|shipped|addressed)\s+(?:in|with|as of|since|on)\s+(v?\d+\.\d+[\w.-]*|`[^`\n]{1,30}`|the\s+[\w.-]+\s+(?:tag|release|branch|version|channel))/i;
const FIX_LABEL = /fixed[- ]in|fix[- ]available|pending[- ]release|resolved[- ]in|released/i;

/** A maintainer saying the bug is fixed somewhere, or a label that says so. */
export function fixHint(issue: RawIssue): FixHint | undefined {
  for (const c of [...issue.comments].reverse()) {
    if (!MAINTAINER.has(c.association) || c.minimized) continue;
    const m = FIX_RE.exec(dropQuotes(c.body));
    if (m) {
      const start = Math.max(0, c.body.lastIndexOf('.', m.index) + 1);
      const sentence = c.body.slice(start, m.index + m[0].length).replace(/\s+/g, ' ').trim();
      return { text: sentence.slice(-200), url: c.url, author: c.author };
    }
  }
  const label = issue.labels.find((l) => FIX_LABEL.test(l));
  if (label) return { text: `labelled "${label}"`, url: issue.url, author: 'maintainers' };
  return undefined;
}
