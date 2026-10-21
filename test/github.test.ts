import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError } from '../src/github/client.js';
import { canonicalRepo, searchVersionIssues, versionQuery } from '../src/github/issues.js';
import { findToken } from '../src/github/token.js';
import { fakeHttp, replayHttp } from '../src/http.js';
import { parseGitHubRepo } from '../src/registry/repoUrl.js';
import { npmMetadataUrl, resolveNpmRepo, resolvePypiRepo } from '../src/registry/resolve.js';

const http = replayHttp(new URL('./fixtures/http/clients/', import.meta.url).pathname);
const client = (h = http, extra: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}): GitHubClient =>
  new GitHubClient({ http: h, token: 'test-token', sleep: () => Promise.resolve(), ...extra });

describe('parseGitHubRepo', () => {
  it.each([
    [{ type: 'git', url: 'git+https://github.com/colinhacks/zod.git' }, 'colinhacks/zod'],
    ['git+ssh://git@github.com/isaacs/node-glob.git', 'isaacs/node-glob'],
    ['git@github.com:dfcreative/color-name.git', 'dfcreative/color-name'],
    ['git://github.com/debug-js/debug.git', 'debug-js/debug'],
    ['https://github.com/npm/wrappy', 'npm/wrappy'],
    ['http://github.com/substack/node-mkdirp.git', 'substack/node-mkdirp'],
    ['github:sindresorhus/is-plain-obj', 'sindresorhus/is-plain-obj'],
    ['sindresorhus/is-plain-obj', 'sindresorhus/is-plain-obj'],
    ['https://github.com/TanStack/query/tree/main/packages/react-query#readme', 'TanStack/query'],
    ['https://www.github.com/psf/requests/issues', 'psf/requests'],
    ['ssh://git@github.com:22/o/r.git', 'o/r'],
    ['https://github.com/sponsors/samuelcolvin', undefined],
    ['https://github.com/through2.git', undefined],
    ['https://gitlab.com/o/r', undefined],
    ['https://gist.github.com/x/y', undefined],
    [null, undefined],
    [{ url: 42 }, undefined],
  ])('%j → %s', (input, expected) => {
    const r = parseGitHubRepo(input);
    expect(r ? `${r.owner}/${r.name}` : undefined).toBe(expected);
  });
});

describe('registry resolution (recorded)', () => {
  it('npm: object repository, monorepo directory, 404', async () => {
    expect(await resolveNpmRepo(http, 'zod', '3.23.8')).toEqual({ status: 'ok', repo: { owner: 'colinhacks', name: 'zod' } });
    expect(await resolveNpmRepo(http, '@tanstack/react-query', '5.59.0')).toEqual({
      status: 'ok',
      repo: { owner: 'TanStack', name: 'query' },
      directory: 'packages/react-query',
    });
    expect((await resolveNpmRepo(http, 'does-not-exist-landmine-test', '1.0.0')).status).toBe('no-repo');
  });

  it('npm metadata URL encodes scoped names', () => {
    expect(npmMetadataUrl('@tanstack/react-query', '5.59.0')).toBe('https://registry.npmjs.org/@tanstack%2Freact-query/5.59.0');
  });

  it('pypi: Source label, sponsors link ignored, no GitHub at all', async () => {
    expect(await resolvePypiRepo(http, 'requests', '2.32.3')).toEqual({ status: 'ok', repo: { owner: 'psf', name: 'requests' } });
    expect(await resolvePypiRepo(http, 'pydantic', '2.9.2')).toEqual({ status: 'ok', repo: { owner: 'pydantic', name: 'pydantic' } });
    expect((await resolvePypiRepo(http, 'beautifulsoup4', '4.12.3')).status).toBe('no-repo');
  });
});

describe('GitHub (recorded)', () => {
  it('canonicalRepo follows renames and returns undefined for 404', async () => {
    expect(await canonicalRepo(client(), 'tiangolo', 'fastapi')).toEqual({ fullName: 'fastapi/fastapi', archived: false, hasIssues: true });
    expect(await canonicalRepo(client(), 'landmine-nonexistent-owner', 'nope')).toBeUndefined();
  });

  it('searchVersionIssues returns issues with comments, oldest first', async () => {
    const { searchHits, issues } = await searchVersionIssues(client(), 'drizzle-team/drizzle-orm', '0.36.0', 30);
    expect(searchHits).toBe(16);
    expect(issues).toHaveLength(16);
    const i3402 = issues.find((i) => i.number === 3402);
    expect(i3402?.title).toMatch(/end function/);
    expect(i3402?.comments.some((c) => c.body.includes('@ts-expect-error'))).toBe(true);
    const dates = i3402?.comments.map((c) => c.createdAt) ?? [];
    expect([...dates].sort()).toEqual(dates);
  });

  it('builds the version query with the v-prefixed variant', () => {
    expect(versionQuery('o/r', '1.2.3')).toBe('repo:o/r is:issue is:open ("1.2.3" OR "v1.2.3") sort:reactions-desc');
  });

  it('replay refuses unrecorded requests', async () => {
    await expect(http.fetch('https://example.com/nope')).rejects.toThrow(/No recorded response/);
  });
});

describe('GitHubClient retry policy', () => {
  const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

  it('honors retry-after on 403', async () => {
    let calls = 0;
    const sleep = vi.fn(() => Promise.resolve());
    const h = fakeHttp(() => (++calls === 1 ? new Response('rate limited', { status: 403, headers: { 'retry-after': '2' } }) : ok({ full_name: 'a/b' })));
    const r = await client(h, { sleep }).rest<{ full_name: string }>('/repos/a/b');
    expect(r?.full_name).toBe('a/b');
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('waits until x-ratelimit-reset when remaining is 0', async () => {
    let calls = 0;
    const sleep = vi.fn(() => Promise.resolve());
    const now = (): number => 1_000_000_000_000;
    const reset = String(1_000_000_000 + 30);
    const h = fakeHttp(() =>
      ++calls === 1 ? new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }) : ok({}),
    );
    await client(h, { sleep, now }).rest('/x');
    expect(sleep).toHaveBeenCalledWith(31_000);
  });

  it('gives up instead of waiting longer than maxWaitMs', async () => {
    const h = fakeHttp(() => new Response('{}', { status: 429, headers: { 'retry-after': '3600' } }));
    await expect(client(h).rest('/x')).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('retries 5xx, then succeeds', async () => {
    let calls = 0;
    const h = fakeHttp(() => (++calls < 3 ? new Response('boom', { status: 502 }) : ok({ ok: true })));
    expect(await client(h).rest('/x')).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('401 is an auth error', async () => {
    const h = fakeHttp(() => new Response('bad', { status: 401 }));
    await expect(client(h).rest('/x')).rejects.toBeInstanceOf(GitHubError);
    await expect(client(h).rest('/x')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('GraphQL RATE_LIMITED errors are retried', async () => {
    let calls = 0;
    const h = fakeHttp(() =>
      ++calls === 1 ? ok({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }) : ok({ data: { viewer: { login: 'x' } } }),
    );
    expect(await client(h).graphql('query { viewer { login } }', {})).toEqual({ viewer: { login: 'x' } });
  });

  it('sends auth, user agent and API version headers', async () => {
    let seen: Headers | undefined;
    const h = {
      fetch: (_url: string, init?: RequestInit): Promise<Response> => {
        seen = new Headers(init?.headers);
        return Promise.resolve(ok({}));
      },
    };
    await client(h).rest('/x');
    expect(seen?.get('authorization')).toBe('Bearer test-token');
    expect(seen?.get('user-agent')).toMatch(/^landmines\//);
    expect(seen?.get('x-github-api-version')).toBe('2026-03-10');
  });
});

describe('findToken', () => {
  it('prefers GITHUB_TOKEN, then GH_TOKEN, then gh', async () => {
    const exec = vi.fn(() => Promise.resolve('gho_cli\n'));
    expect(await findToken({ GITHUB_TOKEN: 'a', GH_TOKEN: 'b' }, exec)).toEqual({ token: 'a', source: 'GITHUB_TOKEN' });
    expect(await findToken({ GH_TOKEN: 'b' }, exec)).toEqual({ token: 'b', source: 'GH_TOKEN' });
    expect(await findToken({}, exec)).toEqual({ token: 'gho_cli', source: 'gh auth token' });
    expect(await findToken({}, () => Promise.reject(new Error('no gh')))).toBeUndefined();
  });
});

describe('GraphQL rate limits and partial data', () => {
  it('waits until the reset from the headers, and gives up when that is too far away', async () => {
    const waits: number[] = [];
    let calls = 0;
    const now = 1_800_000_000_000;
    const h = fakeHttp(() => {
      calls++;
      return new Response(JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }), {
        status: 200,
        headers: { 'x-ratelimit-reset': String(Math.floor(now / 1000) + 50 * 60) },
      });
    });
    const c = client(h, { now: () => now, sleep: (ms) => (waits.push(ms), Promise.resolve()) });
    await expect(c.graphql('query', {})).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(calls).toBe(1); // a 50-minute reset is past maxWaitMs: no pointless sleeping
    expect(waits).toEqual([]);
  });

  it('skips null nodes that come with partial-data errors', async () => {
    const node = {
      number: 7, title: 't', url: 'https://github.com/o/r/issues/7', body: 'b', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      author: { login: 'a' }, authorAssociation: 'NONE', labels: { nodes: [] }, reactions: { totalCount: 0 },
      comments: { totalCount: 0 }, firstComments: { nodes: [null] }, lastComments: { nodes: [] },
    };
    const h = fakeHttp(() => new Response(JSON.stringify({ data: { search: { issueCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [null, node] } }, errors: [{ message: 'partial' }] }), { status: 200 }));
    const r = await searchVersionIssues(client(h), 'o/r', '1.0.0', 10);
    expect(r.issues.map((i) => i.number)).toEqual([7]);
  });
});
