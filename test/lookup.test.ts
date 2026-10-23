import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { GitHubClient } from '../src/github/client.js';
import { type Http, fakeHttp, replayHttp } from '../src/http.js';
import { type LookupResult, formatLookups, lookupPackage, lookupSummary, parseSpec } from '../src/lookup.js';
import { createRemoteHandler, createRemoteServer } from '../src/remote.js';

const HTTP_DIR = fileURLToPath(new URL('./fixtures/http/scan-demo/', import.meta.url));
const textOf = (r: unknown): string => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '');
const isError = (r: unknown): boolean => Boolean((r as { isError?: boolean }).isError);

function deps(http: Http = replayHttp(HTTP_DIR)) {
  return { http, github: new GitHubClient({ http, token: 't', maxRetries: 0 }), maxIssues: 30 };
}

describe('parseSpec', () => {
  it('reads npm, scoped, PyPI and bare specs', () => {
    expect(parseSpec('next@16.4.0')).toEqual({ ecosystem: 'npm', name: 'next', version: '16.4.0' });
    expect(parseSpec('@tanstack/react-table@9.2.4')).toEqual({ ecosystem: 'npm', name: '@tanstack/react-table', version: '9.2.4' });
    expect(parseSpec('@scope/pkg')).toEqual({ ecosystem: 'npm', name: '@scope/pkg' });
    expect(parseSpec('Beautiful_Soup4==4.12.3')).toEqual({ ecosystem: 'pypi', name: 'beautiful-soup4', version: '4.12.3' });
    expect(parseSpec('pypi:requests@2.32.3')).toEqual({ ecosystem: 'pypi', name: 'requests', version: '2.32.3' });
    expect(parseSpec('requests@2.32.3', 'pypi')).toEqual({ ecosystem: 'pypi', name: 'requests', version: '2.32.3' });
    expect(parseSpec('react@v19.2.0')).toEqual({ ecosystem: 'npm', name: 'react', version: '19.2.0' });
    expect(parseSpec('next@16.0.0-canary.3')).toEqual({ ecosystem: 'npm', name: 'next', version: '16.0.0-canary.3' });
    expect(parseSpec('vite@latest')).toEqual({ ecosystem: 'npm', name: 'vite' });
  });

  it('refuses ranges and junk, saying what to pass instead', () => {
    expect(parseSpec('react@^19.0.0')).toEqual({ error: expect.stringContaining('exact version') as string });
    expect(parseSpec('react@>=18 <20')).toHaveProperty('error');
    expect(parseSpec('two words@1.0.0')).toHaveProperty('error');
    expect(parseSpec('@1.0.0')).toHaveProperty('error');
  });
});

describe('lookupPackage', () => {
  it('runs the scan pipeline for one version: verified, reportable, one entry per issue', async () => {
    const r = await lookupPackage({ ecosystem: 'npm', name: 'drizzle-orm', version: '0.36.0' }, deps());
    expect(r.status).toBe('ok');
    expect(r.repo).toBe('drizzle-team/drizzle-orm');
    const ids = r.landmines.map((l) => l.id);
    expect(ids).toContain('drizzle-team/drizzle-orm#3402');
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.landmines.every((l) => l.evidence.strength !== 'weak' && !l.nonBug)).toBe(true);
    expect(lookupSummary(r)).toMatch(/^drizzle-orm@0\.36\.0 \(drizzle-team\/drizzle-orm\): \d+ open GitHub issues filed against this exact version/);
  });

  it('looks PyPI packages up too', async () => {
    const r = await lookupPackage({ ecosystem: 'pypi', name: 'requests', version: '2.32.3' }, deps());
    expect(r.status).toBe('ok');
    expect(r.landmines.some((l) => l.id.startsWith('psf/requests#'))).toBe(true);
  });

  it('serves a cached result without touching the network, and does not cache failures', async () => {
    const store = new Map<string, LookupResult>();
    const cache = { get: (k: string) => Promise.resolve(store.get(k)), put: (k: string, v: LookupResult) => Promise.resolve(void store.set(k, v)) };
    const first = await lookupPackage({ ecosystem: 'npm', name: 'drizzle-orm', version: '0.36.0' }, { ...deps(), cache });
    const offline = fakeHttp(() => Promise.reject(new Error('network is off')));
    const again = await lookupPackage({ ecosystem: 'npm', name: 'drizzle-orm', version: '0.36.0' }, { ...deps(offline), cache });
    expect(again.landmines.map((l) => l.id)).toEqual(first.landmines.map((l) => l.id));
    const failed = await lookupPackage({ ecosystem: 'npm', name: 'zod', version: '9.9.9' }, { ...deps(offline), cache });
    expect(failed.status).toBe('error');
    expect(store.size).toBe(1);
  });

  it('a bare name uses the registry latest; an unknown package is not-found', async () => {
    const http = fakeHttp((_m, url) => {
      if (url === 'https://registry.npmjs.org/left-pad/latest') return new Response(JSON.stringify({ version: '1.3.0' }));
      if (url.startsWith('https://registry.npmjs.org/no-such-pkg')) return new Response('{}', { status: 404 });
      return replayHttp(HTTP_DIR).fetch(url, {});
    });
    const latest = await lookupPackage({ ecosystem: 'npm', name: 'left-pad' }, { ...deps(http), github: new GitHubClient({ http: replayHttp(HTTP_DIR), token: 't' }) });
    expect(latest).toMatchObject({ version: '1.3.0', latest: true });
    expect(lookupSummary(latest)).toContain('left-pad@1.3.0 (latest, ');
    const missing = await lookupPackage({ ecosystem: 'npm', name: 'no-such-pkg' }, deps(http));
    expect(missing.status).toBe('not-found');
  });

  it('formats a summary line per package, the untrusted notice, and the issues', async () => {
    const r = await lookupPackage({ ecosystem: 'npm', name: 'drizzle-orm', version: '0.36.0' }, deps());
    const t = formatLookups([r]);
    expect(t.split('\n')[0]).toBe(lookupSummary(r));
    expect(t).toContain('untrusted third-party content');
    expect(t).toContain('<<< begin issue text from GitHub');
    expect(formatLookups([r], { maxChars: 500 })).toMatch(/more not shown/);
  });
});

describe('hosted MCP server (landmine.tech/mcp)', () => {
  async function connect(env: Parameters<typeof createRemoteServer>[0]) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createRemoteServer(env).connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);
    return client;
  }
  const env = { githubToken: 't', http: replayHttp(HTTP_DIR), maxIssues: 30 };

  it('offers landmine_lookup and landmine_check, read-only, with instructions and an icon', async () => {
    const client = await connect(env);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['landmine_check', 'landmine_lookup']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations.destructiveHint === false)).toBe(true);
    expect(client.getInstructions()).toContain('exact versions');
    expect(client.getServerVersion()).toMatchObject({ name: 'landmine', websiteUrl: 'https://landmine.tech' });
  });

  it('landmine_lookup reports the versions, notes bad specs, and filters by query', async () => {
    const client = await connect(env);
    const t = textOf(await client.callTool({ name: 'landmine_lookup', arguments: { packages: ['drizzle-orm@0.36.0', 'zod@^3'] } }));
    expect(t).toContain('"zod@^3": pass the exact version');
    expect(t).toContain('drizzle-team/drizzle-orm#3402');
    const q = textOf(await client.callTool({ name: 'landmine_lookup', arguments: { packages: ['drizzle-orm@0.36.0'], query: 'Maximum call stack size exceeded on insert RangeError' } }));
    expect(q).toContain('drizzle-team/drizzle-orm#1740');
    const bad = await client.callTool({ name: 'landmine_lookup', arguments: { packages: ['react@~19'] } });
    expect(isError(bad)).toBe(true);
  });

  it('landmine_check matches a snippet against the versions it runs on', async () => {
    const client = await connect(env);
    const code = "import { drizzle } from 'drizzle-orm/node-postgres';\nexport const db = drizzle({ connection: 'x' });\nexport const close = () => db.$client.end();\n";
    const t = textOf(await client.callTool({ name: 'landmine_check', arguments: { code, packages: ['drizzle-orm@0.36.0'] } }));
    expect(t).toContain('drizzle-team/drizzle-orm#3402');
    const py = textOf(await client.callTool({ name: 'landmine_check', arguments: { code: 'import requests\nrequests.put(url, data=d)\n', packages: ['requests==2.32.3'] } }));
    expect(py).toContain('psf/requests#');
  });

  it('says so plainly when the server has no GitHub token', async () => {
    const client = await connect({ http: replayHttp(HTTP_DIR) });
    const r = await client.callTool({ name: 'landmine_lookup', arguments: { packages: ['zod@3.23.8'] } });
    expect(isError(r)).toBe(true);
    expect(textOf(r)).toContain('server problem');
  });

  it('answers Streamable HTTP: initialize over a web-standard Request', async () => {
    const handler = createRemoteHandler(env);
    const res = await handler.fetch(
      new Request('https://landmine.tech/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"name":"landmine"');
    expect(body).toContain('"instructions"');
  });
});
