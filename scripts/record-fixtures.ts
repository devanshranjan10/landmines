/**
 * Re-record the HTTP fixtures used by the offline test suite.
 * Needs network and a GitHub token (GITHUB_TOKEN / GH_TOKEN / `gh auth token`).
 *
 *   npx tsx scripts/record-fixtures.ts clients
 */
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GitHubClient } from '../src/github/client.js';
import { canonicalRepo, searchVersionIssues } from '../src/github/issues.js';
import { findToken } from '../src/github/token.js';
import { recordingHttp } from '../src/http.js';
import { resolveNpmRepo, resolvePypiRepo, resolveRepo } from '../src/registry/resolve.js';
import type { Dependency } from '../src/types.js';

/** Real projects' pins used to calibrate and test issue analysis. */
export const CORPUS: Array<[Dependency['ecosystem'], string, string]> = [
  ['npm', 'drizzle-orm', '0.36.0'],
  ['npm', 'next', '14.2.3'],
  ['npm', 'vite', '5.4.10'],
  ['npm', '@tanstack/react-query', '5.59.0'],
  ['npm', 'date-fns', '3.6.0'],
  ['npm', 'typeorm', '0.3.20'],
  ['pypi', 'pydantic', '2.9.2'],
  ['pypi', 'requests', '2.32.3'],
  ['pypi', 'sqlalchemy', '2.0.36'],
];

const set = process.argv[2] ?? 'clients';
const dir = fileURLToPath(new URL(`../test/fixtures/http/${set}/`, import.meta.url));

const token = await findToken();
if (!token) throw new Error('No GitHub token found');
rmSync(dir, { recursive: true, force: true });
const http = recordingHttp(dir);
const gh = new GitHubClient({ http, token: token.token, log: (m) => console.error(m) });

if (set === 'clients') {
  for (const [n, v] of [
    ['zod', '3.23.8'],
    ['@tanstack/react-query', '5.59.0'],
    ['next', '14.2.3'],
    ['drizzle-orm', '0.36.0'],
    ['left-pad', '1.3.0'],
    ['does-not-exist-landmine-test', '1.0.0'],
  ] as const) {
    console.log('npm', n, v, JSON.stringify(await resolveNpmRepo(http, n, v)));
  }
  for (const [n, v] of [
    ['requests', '2.32.3'],
    ['pydantic', '2.9.2'],
    ['fastapi', '0.115.0'],
    ['beautifulsoup4', '4.12.3'],
  ] as const) {
    console.log('pypi', n, v, JSON.stringify(await resolvePypiRepo(http, n, v)));
  }
  for (const [o, r] of [
    ['tiangolo', 'fastapi'],
    ['drizzle-team', 'drizzle-orm'],
    ['landmine-nonexistent-owner', 'nope'],
  ] as const) {
    console.log('repo', o, r, JSON.stringify(await canonicalRepo(gh, o, r)));
  }
  const s = await searchVersionIssues(gh, 'drizzle-team/drizzle-orm', '0.36.0', 30);
  console.log('search drizzle-orm 0.36.0', s.searchHits, s.issues.length);
}

if (set === 'corpus') {
  for (const [ecosystem, name, version] of CORPUS) {
    const res = await resolveRepo(http, { ecosystem, name, version, dev: false, source: 'corpus' });
    if (!res.repo) {
      console.log(name, res.status);
      continue;
    }
    const canon = await canonicalRepo(gh, res.repo.owner, res.repo.name);
    if (!canon) continue;
    const s = await searchVersionIssues(gh, canon.fullName, version, 50);
    console.log(`${name}@${version} ${canon.fullName} hits=${s.searchHits} fetched=${s.issues.length}`);
  }
}
