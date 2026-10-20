import type { RawIssue } from '../github/issues.js';
import type { Lang } from '../source/lex.js';
import type { Ecosystem, Landmine } from '../types.js';
import { issueSymbols } from './issueSymbols.js';
import { type DropReason, type PackageContext, packageAliases, strengthRank, versionEvidence } from './version.js';
import { boilerplateBodies, fixHint, pickWorkaround } from './workaround.js';

export interface BuildContext extends PackageContext {
  ecosystem: Ecosystem;
  /** PyPI: import names; npm: defaults to [name]. */
  importNames?: string[];
}

export interface BuildResult {
  landmines: Landmine[];
  dropped: Record<DropReason, number>;
}

/** Turn raw search hits into verified, scored landmines for one package version. */
export function buildLandmines(raw: RawIssue[], ctx: BuildContext): BuildResult {
  const dropped: Record<DropReason, number> = { unverified: 0, unaffected: 0, incidental: 0 };
  const boilerplate = boilerplateBodies(raw);
  const lang: Lang = ctx.ecosystem === 'pypi' ? 'py' : 'js';
  const importNames = ctx.importNames?.length ? ctx.importNames : [ctx.name];
  const aliases = packageAliases(ctx);
  const landmines: Landmine[] = [];

  for (const issue of raw) {
    const ev = versionEvidence(issue, ctx);
    if ('dropped' in ev) {
      dropped[ev.dropped]++;
      continue;
    }
    const workaround = pickWorkaround(issue, ctx.name, boilerplate);
    const fix = fixHint(issue);
    landmines.push({
      id: `${issue.repo}#${issue.number}`,
      ecosystem: ctx.ecosystem,
      package: ctx.name,
      version: ctx.version,
      issue: {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        author: issue.author,
        labels: issue.labels,
        reactions: issue.positiveReactions,
        comments: issue.commentCount,
      },
      evidence: ev.evidence,
      symbols: issueSymbols(issue, { packageName: ctx.name, packageAliases: aliases, importNames, lang }),
      ...(workaround ? { workaround } : {}),
      ...(fix ? { fixHint: fix } : {}),
    });
  }

  applyUbiquityPenalty(landmines);
  landmines.sort(
    (a, b) =>
      strengthRank(b.evidence.strength) - strengthRank(a.evidence.strength) || b.issue.reactions - a.issue.reactions || a.issue.number - b.issue.number,
  );
  return { landmines, dropped };
}

/** A symbol in more than half of a package's landmines (its main entry point) identifies none of them. */
export function applyUbiquityPenalty(landmines: Landmine[]): void {
  if (landmines.length < 4) return;
  const df = new Map<string, number>();
  for (const l of landmines) for (const s of l.symbols) df.set(s.name, (df.get(s.name) ?? 0) + 1);
  for (const l of landmines) {
    for (const s of l.symbols) {
      if ((df.get(s.name) ?? 0) / landmines.length > 0.5) s.score = Math.round(s.score * 50) / 100;
    }
  }
}
