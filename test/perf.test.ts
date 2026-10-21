import { describe, expect, it } from 'vitest';
import { chainsIn } from '../src/analyze/issueSymbols.js';
import { buildLandmines } from '../src/analyze/landmine.js';
import { dropQuotes, dropTaskLists, stripNoise } from '../src/analyze/markdown.js';
import { findMentions, inVersionList } from '../src/analyze/version.js';
import type { RawIssue } from '../src/github/issues.js';
import { touches } from '../src/source/touches.js';

/** Adversarial issue text (GitHub allows 65k-character bodies and comments). From the code review. */
const time = (fn: () => unknown): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};
const ctx = { name: 'x', version: '1.2.3', repo: 'o/x' };

describe('analysis stays fast on hostile issue text', () => {
  it('version-list detection does not backtrack exponentially', () => {
    expect(time(() => findMentions(`${'1.11111,'.repeat(10)}! 1.2.3\n`.repeat(700), ctx))).toBeLessThan(1500);
    expect(inVersionList('from versions: 1.22.0, 1.22.1, ', ', 2.1.3, 2.2.0)')).toBe(true);
    expect(inVersionList('pydantic version: ', '\nPython: 3.12')).toBe(false);
  });

  it('thousands of mentions on one line', () => {
    expect(time(() => findMentions('1.2.3 '.repeat(10800), ctx))).toBeLessThan(1500);
  });

  it('long blank runs in markdown and chains', () => {
    const blanks = '\n'.repeat(65000);
    expect(time(() => dropTaskLists(blanks))).toBeLessThan(500);
    expect(time(() => dropQuotes(blanks))).toBeLessThan(500);
    expect(time(() => chainsIn(`a${' '.repeat(65000)}b`))).toBeLessThan(500);
    expect(time(() => stripNoise('<!--'.repeat(16000)))).toBeLessThan(500);
    expect(time(() => stripNoise('!['.repeat(30000)))).toBeLessThan(500);
  });

  it('a whole issue with hostile comments builds quickly', () => {
    const issue: RawIssue = {
      repo: 'o/x',
      number: 1,
      title: 'x 1.2.3 broken',
      url: 'u',
      body: `x@1.2.3\n${'\n'.repeat(60000)}`,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      author: 'a',
      association: 'NONE',
      labels: [],
      positiveReactions: 0,
      commentCount: 3,
      comments: [0, 1, 2].map((i) => ({ id: `c${i}`, url: 'u', body: '\n'.repeat(60000), createdAt: '2026-01-02', author: 'b', association: 'NONE', minimized: false, positiveReactions: 0 })),
    };
    expect(time(() => buildLandmines([issue], { ecosystem: 'npm', name: 'x', version: '1.2.3', repo: 'o/x' }))).toBeLessThan(2000);
  });

  it('unbalanced brackets in edited source', () => {
    expect(time(() => touches({ fileText: "import foo from 'foo';\n", changedText: 'foo('.repeat(20000), lang: 'js' }))).toBeLessThan(2000);
    expect(time(() => touches({ fileText: "import foo from 'foo';\n", changedText: 'foo < '.repeat(20000), lang: 'js' }))).toBeLessThan(2000);
  });
});
