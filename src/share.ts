import { isArmed } from './policy.js';
import type { LandmineIndex } from './types.js';

/** shields.io static badge path segment: `-` and `_` are escaped, spaces become `_`. */
function badgeSegment(text: string): string {
  return encodeURIComponent(text.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_'));
}

/**
 * A short, postable summary of what `scan` found, plus a README badge. Only counts, package names and versions: no
 * issue text, no paths.
 */
export function shareText(index: LandmineIndex): string {
  const issues = index.landmines.length;
  const withIssues = new Set(index.landmines.map((l) => `${l.ecosystem}:${l.package}@${l.version}`)).size;
  const scanned = index.packages.filter((p) => p.status === 'ok').length;
  const armed = index.landmines.filter(isArmed).length;
  const workarounds = index.landmines.filter((l) => l.workaround?.kind === 'workaround' || l.card?.workaround).length;
  const top = [...new Set(index.landmines.map((l) => l.package))]
    .map((p) => ({ p, n: index.landmines.filter((l) => l.package === p).length }))
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
