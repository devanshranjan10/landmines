import { isArmed } from './policy.js';
import { reportable } from './render.js';
import type { Landmine, LandmineIndex } from './types.js';

/** shields.io static badge path segment: `-` and `_` are escaped, spaces become `_`. */
function badgeSegment(text: string): string {
  return encodeURIComponent(text.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_'));
}

/**
 * A short, postable summary of what `scan` found, plus a README badge. Only counts, package names and versions: no
 * issue text, no paths.
 */
export function shareText(index: LandmineIndex): string {
  // The same counts `scan` prints: weak mentions and non-bugs left out, and an issue counted once even when several
  // packages from one repo pin it (storybook and its addons, react and react-dom).
  const real = index.landmines.filter(reportable);
  const unique = (ls: Landmine[]): number => new Set(ls.map((l) => l.id)).size;
  const issues = unique(real);
  const withIssues = new Set(real.map((l) => `${l.ecosystem}:${l.package}@${l.version}`)).size;
  const scanned = index.packages.filter((p) => p.status === 'ok').length;
  const armed = unique(real.filter(isArmed));
  const workarounds = unique(real.filter((l) => l.workaround?.kind === 'workaround' || l.card?.workaround));
  const top = [...new Set(real.map((l) => l.package))]
    .map((p) => ({ p, n: unique(real.filter((l) => l.package === p)) }))
    .sort((a, b) => b.n - a.n || a.p.localeCompare(b.p))
    .slice(0, 3)
    .map(({ p, n }) => `${p} (${n})`);
  const line =
    issues === 0
      ? `landmine found no open GitHub issues filed against the exact dependency versions this project pins (${scanned} checked).`
      : `landmine found ${issues} open GitHub issue${issues === 1 ? '' : 's'} filed against the exact versions this project pins, in ${withIssues} of ${scanned} dependencies${top.length ? ` (most: ${top.join(', ')})` : ''}. ${armed} point at specific APIs, ${workarounds} ${workarounds === 1 ? 'has' : 'have'} a workaround in the thread.`;
  const message = `${issues} open bug${issues === 1 ? '' : 's'} in pinned deps`;
  const badge = `[![landmine](https://img.shields.io/badge/${badgeSegment('landmine')}-${badgeSegment(message)}-${issues ? 'e05d44' : '44cc11'})](https://landmine.tech)`;
  return [line, 'Check yours: npx landmines scan', '', 'README badge:', badge].join('\n');
}
