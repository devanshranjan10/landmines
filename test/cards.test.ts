import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CardOutput, CardSchema, addCards, cardPrompt, exportCards, loadCards, toCard } from '../src/cards.js';
import type { RawIssue } from '../src/github/issues.js';
import type { Http } from '../src/http.js';
import { type LlmProvider, provider } from '../src/llm.js';
import { cardMatch, checkFile, fileContext, matchTouches } from '../src/match.js';
import { modelMessage } from '../src/message.js';
import { isArmed } from '../src/policy.js';
import { touches } from '../src/source/touches.js';
import { INDEX_DIR } from '../src/store.js';
import type { Landmine, LandmineIndex, TriggerCard } from '../src/types.js';

function landmine(over: Partial<Landmine> = {}): Landmine {
  return {
    id: 'date-fns/date-fns#4384',
    ecosystem: 'npm',
    package: 'date-fns',
    version: '4.4.0',
    issue: {
      number: 4384,
      title: 'add() ignores weeks in a Duration',
      url: 'https://github.com/date-fns/date-fns/issues/4384',
      createdAt: '2026-07-10T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
      author: 'reporter',
      labels: [],
      reactions: 3,
      comments: 2,
    },
    evidence: { strength: 'strong', where: 'body', kind: 'template', quote: 'date-fns 4.4.0' },
    symbols: [{ name: 'add', score: 0.9, sources: ['title'] }] as Landmine['symbols'],
    ...over,
  };
}

const CARD: TriggerCard = {
  isBug: true,
  affectsPinned: 'yes',
  apis: ['add'],
  requires: [['weeks']],
  condition: 'add(date, { weeks }) ignores the weeks part and returns the start date',
  workaround: 'Convert weeks to days: add(date, { days: weeks * 7 }).',
  confidence: 0.9,
  provider: 'test',
  model: 'm',
  promptVersion: 1,
};

function indexWith(...landmines: Landmine[]): LandmineIndex {
  return {
    schema: 1,
    generator: 'test',
    generatedAt: '2026-10-21T00:00:00Z',
    lockfiles: [],
    packages: [
      { ecosystem: 'npm', name: 'date-fns', version: '4.4.0', dev: false, status: 'ok', searchHits: 0, verified: 0, landmines: 1, dropped: { unverified: 0, unaffected: 0, incidental: 0 } },
      {
        ecosystem: 'pypi',
        name: 'pandas',
        version: '3.0.1',
        dev: false,
        importNames: ['pandas'],
        status: 'ok',
        searchHits: 0,
        verified: 0,
        landmines: 1,
        dropped: { unverified: 0, unaffected: 0, incidental: 0 },
      },
    ],
    landmines,
  };
}

const NAIVE = `import { add } from 'date-fns';
export const due = (d: Date, weeks: number) => add(d, { weeks });
`;
const FIXED = `import { add } from 'date-fns';
export const due = (d: Date, n: number) => add(d, { days: n * 7 });
`;

describe('cardMatch', () => {
  it('fires on the API plus a required token, and not without the token', () => {
    expect(cardMatch(CARD, NAIVE, NAIVE, 'js')).toEqual({ api: 'add', via: 'weeks' });
    expect(cardMatch(CARD, FIXED, FIXED, 'js')).toBeUndefined();
  });

  it('ignores comments, and needs the API in the changed text', () => {
    const commented = `import { add } from 'date-fns';\n// never pass { weeks } here\nexport const due = (d: Date) => add(d, { days: 7 });\n`;
    expect(cardMatch(CARD, commented, commented, 'js')).toBeUndefined();
    expect(cardMatch(CARD, NAIVE, 'const unrelated = 1;', 'js')).toBeUndefined();
  });

  it('finds required tokens inside string literals (format strings) as whole words', () => {
    const card = { ...CARD, apis: ['format'], requires: [['Hmm', 'Hm']] };
    expect(cardMatch(card, `format(d, 'yyyy Hmm')`, `format(d, 'yyyy Hmm')`, 'js')).toEqual({ api: 'format', via: 'Hmm' });
    expect(cardMatch(card, `format(d, 'HHmmss')`, `format(d, 'HHmmss')`, 'js')).toBeUndefined();
  });

  it('matches Python keyword arguments, dotted tokens and OR-groups', () => {
    const card = { ...CARD, apis: ['DataFrame.fillna'], requires: [['downcast', 'pd.NA']] };
    const py = `import pandas as pd\ndf = pd.read_csv("x.csv")\nout = df.fillna(pd.NA)\n`;
    expect(cardMatch(card, py, py, 'py')).toEqual({ api: 'DataFrame.fillna', via: 'pd.NA' });
    expect(cardMatch(card, 'df.fillna(0)', 'df.fillna(0)', 'py')).toBeUndefined();
  });

  it('with no requirements, calling the API is enough', () => {
    expect(cardMatch({ ...CARD, requires: [] }, FIXED, FIXED, 'js')).toEqual({ api: 'add' });
  });
});

describe('matching with cards', () => {
  it('a card replaces the symbol heuristics: naive blocks with the card, the workaround does not fire', () => {
    const index = indexWith(landmine({ card: CARD }));
    const hit = (text: string) => matchTouches(touches({ fileText: text, changedText: text, lang: 'js' }), index, 'js', fileContext(text, 'js'));
    const [h] = hit(NAIVE);
    expect(h).toMatchObject({ symbol: 'add', corroboratedBy: 'weeks', viaCard: true });
    expect(hit(FIXED)).toEqual([]);
  });

  it('a file that does not import the package never matches', () => {
    const index = indexWith(landmine({ card: CARD }));
    const text = `const add = (a, b) => a + b;\nadd(1, { weeks: 2 });\n`;
    expect(matchTouches([], index, 'js', fileContext(text, 'js'))).toEqual([]);
  });

  it('a card that disarms the issue silences it completely', () => {
    for (const card of [{ ...CARD, isBug: false }, { ...CARD, affectsPinned: 'no' as const }, { ...CARD, selfCheck: 'fail' as const }]) {
      const l = landmine({ card });
      expect(isArmed(l)).toBe(false);
      const index = indexWith(l);
      expect(matchTouches(touches({ fileText: NAIVE, changedText: NAIVE, lang: 'js' }), index, 'js', fileContext(NAIVE, 'js'))).toEqual([]);
    }
  });

  it('low-confidence cards are heads-ups, not blocks', () => {
    const index = indexWith(landmine({ card: { ...CARD, confidence: 0.3 } }));
    const [h] = matchTouches([], index, 'js', fileContext(NAIVE, 'js'));
    expect(h?.viaCard).toBe(true);
    expect(h?.corroboratedBy).toBeUndefined();
  });

  it('the message states the condition and the summarised workaround', () => {
    const index = indexWith(landmine({ card: CARD }));
    const hits = matchTouches([], index, 'js', fileContext(NAIVE, 'js'));
    const text = modelMessage(hits);
    expect(text).toContain('The bug: add(date, { weeks }) ignores the weeks part');
    expect(text).toContain('this edit uses `add` together with `weeks`');
    expect(text).toContain('Convert weeks to days');
  });

  it('checkFile uses cards too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-cards-'));
    writeFileSync(join(dir, 'due.ts'), NAIVE);
    expect(checkFile(join(dir, 'due.ts'), indexWith(landmine({ card: CARD })))[0]?.corroboratedBy).toBe('weeks');
  });
});

const RAW: RawIssue = {
  repo: 'date-fns/date-fns',
  number: 4384,
  title: 'add() ignores weeks in a Duration',
  url: 'https://github.com/date-fns/date-fns/issues/4384',
  body: 'On date-fns 4.4.0:\n\n```js\nimport { add } from "date-fns";\nadd(new Date(2026, 0, 1), { weeks: 2 });\n```\nreturns Jan 1.',
  createdAt: '2026-07-10T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  author: 'reporter',
  association: 'NONE',
  labels: [],
  positiveReactions: 3,
  commentCount: 1,
  comments: [
    {
      id: 'c1',
      url: 'https://github.com/date-fns/date-fns/issues/4384#issuecomment-1',
      body: 'Use days: weeks * 7 until this is fixed.',
      createdAt: '2026-07-11T00:00:00Z',
      author: 'helper',
      association: 'CONTRIBUTOR',
      minimized: false,
      positiveReactions: 5,
    },
  ],
};

const OUTPUT: CardOutput = {
  isBug: true,
  affectsPinned: 'yes',
  apis: ['add()', '.add'],
  requires: [['weeks', 'data']],
  condition: 'add with  weeks\nignores them',
  workaround: 'Use days: weeks * 7.',
  workaroundComment: 1,
  confidence: 1.4,
};

describe('toCard', () => {
  it('cleans names, drops generic tokens, clamps confidence, links the workaround comment, and self-checks against the repro', () => {
    const { card, reject } = toCard(OUTPUT, landmine(), RAW, { provider: 'test', model: 'm' });
    expect(reject).toBeUndefined();
    expect(card).toMatchObject({
      apis: ['add'],
      requires: [['weeks']],
      condition: 'add with weeks ignores them',
      workaroundUrl: RAW.comments[0]?.url,
      confidence: 1,
      selfCheck: 'pass',
    });
  });

  it('a token the repro never uses fails the self-check, which disarms the card', () => {
    const { card } = toCard({ ...OUTPUT, requires: [['months']] }, landmine(), RAW, { provider: 'test', model: 'm' });
    expect(card?.selfCheck).toBe('fail');
    expect(isArmed(landmine({ card: card! }))).toBe(false);
  });

  it('rejects a bug card with no usable API name', () => {
    expect(toCard({ ...OUTPUT, apis: ['the add function'] }, landmine(), RAW, { provider: 'test', model: 'm' }).reject).toBe('no usable API name');
  });

  it('the prompt fences the thread as untrusted data and numbers comments', () => {
    const p = cardPrompt(landmine(), RAW);
    expect(p).toContain('pinned version 4.4.0');
    expect(p).toMatch(/<issue>[\s\S]*\[comment 1\] by helper \(CONTRIBUTOR, 5 reactions\)[\s\S]*<\/issue>$/);
  });
});

describe('addCards', () => {
  function fakeLlm(): LlmProvider & { calls: number } {
    const llm = {
      name: 'claude-cli' as const,
      model: 'fake',
      calls: 0,
      json<T>(_s: string, _u: string, schema: { parse(v: unknown): T }): Promise<T> {
        llm.calls++;
        return Promise.resolve(schema.parse(OUTPUT));
      },
    };
    return llm;
  }

  it('cards each candidate once, reads raw threads from the scan cache, and reuses the card cache', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lm-cards-'));
    mkdirSync(join(root, INDEX_DIR, 'cache', 'npm'), { recursive: true });
    writeFileSync(join(root, INDEX_DIR, 'cache', 'npm', 'date-fns@4.4.0.json'), JSON.stringify({ issues: [RAW] }));
    const weak = landmine({ id: 'date-fns/date-fns#1', evidence: { strength: 'weak', where: 'body', kind: 'plain', quote: '' } });
    const index = indexWith(landmine(), weak);
    const llm = fakeLlm();
    const run = await addCards(root, index, llm);
    expect(run).toMatchObject({ generated: 1, cached: 0, noRawText: 0, failed: [] });
    expect(index.landmines[0]?.card?.selfCheck).toBe('pass');
    expect(index.landmines[1]?.card).toBeUndefined();

    const again = indexWith(landmine(), weak);
    expect(await addCards(root, again, llm)).toMatchObject({ generated: 0, cached: 1 });
    expect(llm.calls).toBe(1);

    const out = join(root, 'exported');
    expect(exportCards(again, out)).toBe(1);
    const fresh = indexWith(landmine());
    expect(loadCards(fresh, out)).toBe(1);
    expect(fresh.landmines[0]?.card?.apis).toEqual(['add']);
  });

  it('records failures without throwing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lm-cards-'));
    const llm: LlmProvider = { name: 'openai', model: 'x', json: () => Promise.reject(new Error('rate limited')) };
    const run = await addCards(root, indexWith(landmine()), llm);
    expect(run.failed).toEqual([{ id: 'date-fns/date-fns#4384', error: 'rate limited' }]);
    expect(run.noRawText).toBe(1);
  });
});

describe('providers (recorded responses)', () => {
  it('claude-cli reads structured_output from the JSON envelope and passes no tools or settings', async () => {
    let seen: string[] = [];
    const llm = await provider('claude-cli', {
      model: 'sonnet',
      exec: (args) => {
        seen = args;
        return Promise.resolve(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: OUTPUT }));
      },
    });
    expect(await llm.json('sys', 'user', CardSchema)).toEqual(OUTPUT);
    expect(seen).toEqual(expect.arrayContaining(['-p', '--model', 'sonnet', '--tools', '', '--strict-mcp-config', '--no-session-persistence']));
  });

  it('claude-cli surfaces errors', async () => {
    const llm = await provider('claude-cli', { exec: () => Promise.resolve(JSON.stringify({ is_error: true, result: 'Not logged in' })) });
    await expect(llm.json('s', 'u', CardSchema)).rejects.toThrow('Not logged in');
  });

  it('openai-compatible endpoints get a json_schema response_format', async () => {
    let body: { response_format?: { type?: string } } = {};
    const http: Http = {
      fetch: (_url, init) => {
        body = JSON.parse(init?.body as string) as typeof body;
        return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(OUTPUT) } }] }), { status: 200 }));
      },
    };
    const llm = await provider('openai', { http, env: { OPENAI_BASE_URL: 'http://localhost:1234/v1' } });
    expect(await llm.json('s', 'u', CardSchema)).toEqual(OUTPUT);
    expect(body.response_format?.type).toBe('json_schema');
  });
});
