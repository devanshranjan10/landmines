import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitHubClient, GitHubError } from '../src/github/client.js';
import { type Http, replayHttp } from '../src/http.js';
import { isArmed } from '../src/policy.js';
import { importNamesFor } from '../src/pypiNames.js';
import { renderScanSummary } from '../src/render.js';
import { scan } from '../src/scan.js';
import { readIndex } from '../src/store.js';

const run = promisify(execFile);
const FIXTURE_PROJECT = new URL('./fixtures/projects/scan-demo/', import.meta.url).pathname;
const HTTP_DIR = new URL('./fixtures/http/scan-demo/', import.meta.url).pathname;
const NOW = new Date('2026-10-21T12:00:00Z');

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lm-scan-'));
  for (const f of ['package.json', 'package-lock.json', 'requirements.txt']) cpSync(join(FIXTURE_PROJECT, f), join(dir, f));
  return dir;
}

function clients(http: Http): { http: Http; github: GitHubClient } {
  return { http, github: new GitHubClient({ http, token: 't', sleep: () => Promise.resolve() }) };
}

describe('scan (recorded GitHub, npm and PyPI responses)', () => {
  it('resolves every direct dependency and writes the index', async () => {
    const root = project();
    const result = await scan({ root, ...clients(replayHttp(HTTP_DIR)), maxIssues: 30, now: () => NOW });
    const byName = Object.fromEntries(result.index.packages.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['beautifulsoup4', 'drizzle-orm', 'left-pad', 'requests', 'vite', 'zod']);
    expect(byName['drizzle-orm']).toMatchObject({ status: 'ok', repo: 'drizzle-team/drizzle-orm', searchHits: 16, landmines: 15, verified: 16 });
    expect(byName.vite).toMatchObject({ dev: true, repo: 'vitejs/vite' });
    expect(byName.requests).toMatchObject({ ecosystem: 'pypi', repo: 'psf/requests', importNames: ['requests'] });
    expect(byName.beautifulsoup4?.status).toBe('no-repo');
    expect(byName.zod).toMatchObject({ status: 'ok', landmines: 0 });
    expect(readIndex(root)?.landmines.length).toBe(result.index.landmines.length);
    const l3402 = result.index.landmines.find((l) => l.id === 'drizzle-team/drizzle-orm#3402');
    expect(l3402 && isArmed(l3402)).toBe(true);
  });

  it('reuses results younger than 24h without touching the network', async () => {
    const root = project();
    await scan({ root, ...clients(replayHttp(HTTP_DIR)), maxIssues: 30, now: () => NOW });
    const offline: Http = { fetch: () => Promise.reject(new Error('network used')) };
    const again = await scan({ root, ...clients(offline), maxIssues: 30, now: () => new Date(NOW.getTime() + 3_600_000) });
    expect(again.reused).toBe(6);
    expect(again.index.landmines.length).toBeGreaterThan(20);
  });

  it('isolates per-package failures', async () => {
    const replay = replayHttp(HTTP_DIR);
    const flaky: Http = { fetch: (url, init) => (url.includes('left-pad') ? Promise.resolve(new Response('down', { status: 503 })) : replay.fetch(url, init)) };
    const result = await scan({ root: project(), ...clients(flaky), maxIssues: 30, now: () => NOW, write: false });
    expect(result.index.packages.find((p) => p.name === 'left-pad')?.status).toBe('error');
    expect(result.index.packages.find((p) => p.name === 'drizzle-orm')?.landmines).toBe(15);
  });

  it('aborts on a rejected token', async () => {
    const replay = replayHttp(HTTP_DIR);
    const http: Http = { fetch: (url, init) => (url.startsWith('https://api.github.com') ? Promise.resolve(new Response('bad creds', { status: 401 })) : replay.fetch(url, init)) };
    await expect(scan({ root: project(), ...clients(http), maxIssues: 30, now: () => NOW, write: false })).rejects.toBeInstanceOf(GitHubError);
  });

  it('summary states counts honestly', async () => {
    const result = await scan({ root: project(), ...clients(replayHttp(HTTP_DIR)), maxIssues: 30, now: () => NOW, write: false });
    const text = renderScanSummary(result.index, { skipped: result.skipped, notes: result.notes }, { color: false });
    expect(text).toMatch(/^landmine scanned 6 direct dependencies from package-lock\.json, requirements\.txt/);
    expect(text).toMatch(/drizzle-orm@0\.36\.0 +13 open issues · \d+ tied to symbols · \d+ workarounds/);
    expect(text).toContain('No open issues name the exact version: left-pad@1.3.0, zod@3.23.8');
    expect(text).toContain('Not searched: beautifulsoup4 (no GitHub repo)');
    expect(text).toMatch(/Found 23 open issues filed against your exact versions in 3 of 6 packages\./);
    expect(text).toContain('Search hits dropped: 1 that only mention it in links or hidden comments.');
  });
});

describe('PyPI import names', () => {
  it('uses an installed dist-info when present, then the pipreqs mapping, then the normalized name', () => {
    const root = mkdtempSync(join(tmpdir(), 'lm-venv-'));
    const site = join(root, '.venv', 'lib', 'python3.12', 'site-packages');
    mkdirSync(join(site, 'beautifulsoup4-4.12.3.dist-info'), { recursive: true });
    writeFileSync(join(site, 'beautifulsoup4-4.12.3.dist-info', 'RECORD'), 'bs4/__init__.py,sha256=x,1\nbs4/element.py,,\nbeautifulsoup4-4.12.3.dist-info/METADATA,,\n');
    expect(importNamesFor('beautifulsoup4', root, {})).toEqual(['bs4']);
    expect(importNamesFor('scikit-learn', mkdtempSync(join(tmpdir(), 'lm-novenv-')), {})).toEqual(['sklearn']);
    expect(importNamesFor('PyYAML', mkdtempSync(join(tmpdir(), 'lm-novenv-')), {})).toEqual(['yaml']);
    expect(importNamesFor('python-dateutil', mkdtempSync(join(tmpdir(), 'lm-novenv-')), {})).toEqual(['python_dateutil', 'dateutil']);
  });
});

describe('cli scan (built binary, replayed HTTP)', () => {

  it('prints the summary and exits 0', async () => {
    const root = project();
    const { stdout } = await run(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname, 'scan', '--root', root, '--max-issues', '30', '--quiet'], {
      env: { ...process.env, LANDMINE_HTTP_REPLAY: HTTP_DIR, NO_COLOR: '1' },
    });
    expect(stdout).toContain('Found 23 open issues filed against your exact versions in 3 of 6 packages.');
  });

  it('fails clearly without a lockfile', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'lm-empty-'));
    await expect(
      run(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname, 'scan', '--root', empty], { env: { ...process.env, LANDMINE_HTTP_REPLAY: HTTP_DIR } }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('No supported lockfile found') as unknown });
  });
});
