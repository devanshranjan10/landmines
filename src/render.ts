import { styleText } from 'node:util';
import { isArmed } from './policy.js';
import type { Landmine, LandmineIndex, PackageRecord, SkippedDependency } from './types.js';

export interface RenderOptions {
  color: boolean;
}

type Style = Parameters<typeof styleText>[0];

export function paint(opts: RenderOptions, style: Style, text: string): string {
  return opts.color ? styleText(style, text) : text;
}

export function wantsColor(stream: NodeJS.WriteStream, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined || env.TERM === 'dumb') return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0';
  return Boolean(stream.isTTY);
}

function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** Landmines worth counting as "bugs filed against your exact version": strong or medium evidence, bug reports only. */
export function reportable(l: Landmine): boolean {
  return l.evidence.strength !== 'weak' && !l.nonBug;
}

export interface Totals {
  packages: number;
  packagesWithHits: number;
  issues: number;
  weak: number;
  armed: number;
  workarounds: number;
}

/** Headline numbers. Issues are counted once even when two packages share a repo (react, react-dom). */
export function totals(index: LandmineIndex): Totals {
  const real = index.landmines.filter(reportable);
  const unique = (ls: Landmine[]): number => new Set(ls.map((l) => l.id)).size;
  return {
    packages: index.packages.length,
    packagesWithHits: new Set(real.map((l) => `${l.ecosystem}:${l.package}@${l.version}`)).size,
    issues: unique(real),
    weak: unique(index.landmines.filter((l) => !reportable(l) && !real.some((r) => r.id === l.id))),
    armed: unique(real.filter(isArmed)),
    workarounds: unique(real.filter((l) => l.workaround?.kind === 'workaround')),
  };
}

function skipLabel(p: PackageRecord): string {
  switch (p.status) {
    case 'no-repo':
      return p.detail?.includes('disabled') ? 'issues disabled' : 'no GitHub repo';
    case 'not-github':
      return 'not on GitHub';
    case 'skipped':
      return p.detail ?? 'skipped';
    case 'error':
      return `error: ${p.detail ?? 'unknown'}`;
    default:
      return p.status;
  }
}

export function renderScanSummary(
  index: LandmineIndex,
  extra: { skipped: SkippedDependency[]; notes: string[]; indexFile?: string; reused?: number },
  opts: RenderOptions,
): string {
  const out: string[] = [];
  const t = totals(index);
  out.push(
    `${paint(opts, 'bold', 'landmine')} scanned ${plural(t.packages, 'direct dependency', 'direct dependencies')} from ${index.lockfiles.join(', ') || 'no lockfile'}` +
      (extra.reused ? paint(opts, 'dim', ` (${extra.reused} from cache)`) : ''),
  );
  out.push('');

  const rows: Array<[string, string]> = [];
  for (const p of index.packages) {
    const mine = index.landmines.filter((l) => l.ecosystem === p.ecosystem && l.package === p.name && l.version === p.version && reportable(l));
    if (mine.length === 0) continue;
    const armed = mine.filter(isArmed).length;
    const wa = mine.filter((l) => l.workaround?.kind === 'workaround').length;
    rows.push([
      `${p.name}@${p.version}`,
      `${plural(mine.length, 'open issue')} · ${armed} tied to symbols · ${plural(wa, 'workaround')}${p.detail === 'repository is archived' ? ' · repo archived' : ''}`,
    ]);
  }
  const width = Math.min(40, Math.max(0, ...rows.map((r) => r[0].length)));
  for (const [name, desc] of rows) out.push(`  ${paint(opts, 'yellow', name.padEnd(width))}  ${desc}`);
  if (rows.length) out.push('');

  const clean = index.packages.filter(
    (p) => p.status === 'ok' && !index.landmines.some((l) => l.package === p.name && l.version === p.version && reportable(l)),
  );
  if (clean.length) out.push(paint(opts, 'dim', `  No open issues name the exact version: ${clean.map((p) => `${p.name}@${p.version}`).join(', ')}`));
  const unresolved = index.packages.filter((p) => p.status !== 'ok');
  if (unresolved.length) out.push(paint(opts, 'dim', `  Not searched: ${unresolved.map((p) => `${p.name} (${skipLabel(p)})`).join(', ')}`));
  const unpinned = extra.skipped.filter((s) => s.reason !== 'missing');
  if (unpinned.length) {
    out.push(paint(opts, 'dim', `  Not a registry pin: ${unpinned.slice(0, 8).map((s) => `${s.name} (${s.reason})`).join(', ')}${unpinned.length > 8 ? ', …' : ''}`));
  }
  const dropped = index.packages.reduce(
    (acc, p) => ({ unverified: acc.unverified + p.dropped.unverified, unaffected: acc.unaffected + p.dropped.unaffected, incidental: acc.incidental + p.dropped.incidental }),
    { unverified: 0, unaffected: 0, incidental: 0 },
  );
  const droppedParts = [
    dropped.unverified ? `${dropped.unverified} that never mention the version` : '',
    dropped.unaffected ? `${dropped.unaffected} that only name it as working, fixed or upgraded-from` : '',
    dropped.incidental ? `${dropped.incidental} that only mention it in links or hidden comments` : '',
  ].filter(Boolean);
  if (droppedParts.length) out.push(paint(opts, 'dim', `  Search hits dropped: ${droppedParts.join('; ')}.`));
  if (t.weak) out.push(paint(opts, 'dim', `  ${plural(t.weak, 'weaker mention')} (version only in an unconfirmed comment) kept in the index but never trigger the hook.`));
  for (const n of extra.notes) out.push(paint(opts, 'dim', `  Note: ${n}`));
  if (clean.length || unresolved.length || unpinned.length || droppedParts.length || t.weak || extra.notes.length) out.push('');

  const errored = index.packages.filter((p) => p.status === 'error');
  const stale = errored.filter((p) => p.stale);
  if (stale.length) out.push(paint(opts, 'yellow', `${plural(stale.length, 'package')} could not be fetched; kept the previous scan's issues for them: ${stale.map((p) => p.name).join(', ')}.`));
  if (t.issues === 0 && errored.length) {
    out.push(`No open issues found in the packages that were searched, but ${plural(errored.length, 'package')} could not be searched (see above). Run \`landmine scan\` again later.`);
  } else if (t.issues === 0) {
    out.push(`${paint(opts, 'green', 'No open issues')} are filed against the exact versions you pin.`);
  } else {
    out.push(
      `Found ${paint(opts, 'bold', plural(t.issues, 'open issue'))} filed against your exact versions in ${t.packagesWithHits} of ${plural(t.packages, 'package')}.`,
    );
    out.push(
      `${t.armed} ${t.armed === 1 ? 'points' : 'point'} at specific symbols the hook will watch. ` +
        `${t.workarounds} ${t.workarounds === 1 ? 'has' : 'have'} a workaround in the comments.`,
    );
  }
  if (extra.indexFile) out.push(paint(opts, 'dim', `Index: ${extra.indexFile}`));
  return `${out.join('\n')}\n`;
}
