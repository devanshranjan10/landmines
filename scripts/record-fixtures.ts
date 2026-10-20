/**
 * Re-record the HTTP fixtures used by the offline test suite.
 * Needs network and a GitHub token (GITHUB_TOKEN / GH_TOKEN / `gh auth token`).
 *
 *   npx tsx scripts/record-fixtures.ts clients
 */
import { rmSync } from 'node:fs';
import { GitHubClient } from '../src/github/client.js';
import { canonicalRepo, searchVersionIssues } from '../src/github/issues.js';
import { findToken } from '../src/github/token.js';
import { recordingHttp } from '../src/http.js';
import { resolveNpmRepo, resolvePypiRepo } from '../src/registry/resolve.js';

const set = process.argv[2] ?? 'clients';
const dir = new URL(`../test/fixtures/http/${set}/`, import.meta.url).pathname;

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
