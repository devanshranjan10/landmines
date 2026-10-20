import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProjectRoot, pickNpmLock, readDependencies } from '../src/lockfiles/index.js';
import { normalizeVersion } from '../src/lockfiles/pnpm.js';
import { parseRequirements, pep503, pep508Name } from '../src/lockfiles/python.js';
import { parseYarnV1, splitKeys } from '../src/lockfiles/yarn.js';
import { parseJsonc } from '../src/util/jsonc.js';

const FIX = new URL('./fixtures/lockfiles/', import.meta.url).pathname;

function summary(dir: string): { deps: string[]; skipped: string[] } {
  const r = readDependencies(join(FIX, dir));
  return {
    deps: r.deps.map((d) => `${d.name}@${d.version}${d.dev ? ' dev' : ''}`).sort(),
    skipped: r.skipped.map((s) => `${s.name}:${s.reason}`).sort(),
  };
}

const NPM_WORKSPACE = [
  'chalk@4.1.2',
  'debug@2.6.9',
  'debug@4.4.3',
  'is-number@7.0.0',
  'lodash@4.18.1',
  'ms@2.1.3 dev',
  'react-dom@18.3.1',
  'react@18.3.1',
  'semver@7.8.5',
];

describe('npm package-lock.json', () => {
  it('v3: root + workspace importers, alias resolves to the real package name', () => {
    expect(summary('npmproj')).toEqual({ deps: NPM_WORKSPACE, skipped: [] });
  });

  it('v2: same result from the packages section', () => {
    expect(summary('npmv2').deps).toEqual(NPM_WORKSPACE);
  });

  it('v1: direct deps come from package.json, alias version "npm:chalk@4.1.2" is unpacked', () => {
    expect(summary('npmv1').deps).toEqual([
      'chalk@4.1.2',
      'debug@2.6.9',
      'is-number@7.0.0',
      'lodash@4.18.1',
      'ms@2.1.3 dev',
      'react-dom@18.3.1',
      'react@18.3.1',
    ]);
  });

  it('skips git and file dependencies with a reason', () => {
    expect(summary('npmfile/app')).toEqual({ deps: [], skipped: ['is-odd:git', 'local-thing:file'] });
  });
});

describe('pnpm-lock.yaml', () => {
  const expected = [
    '@babel/core@7.24.0 dev',
    'chalk@4.1.2',
    'debug@4.4.3',
    'lodash@4.18.1',
    'ms@2.1.3 dev',
    'react-dom@18.3.1',
    'react@18.3.1',
    'semver@7.8.5',
  ];

  it.each(['pnpm8', 'pnpm11', 'pnpm11b'])('%s: importers, peer suffixes stripped, workspace link skipped', (dir) => {
    expect(summary(dir)).toEqual({ deps: expected, skipped: ['@me/foo:workspace'] });
  });

  it('multi-document lockfile: reads the last (project) document, not the config-deps one', () => {
    const r = summary('pnpmmulti');
    expect(r.deps).toContain('react@18.2.0');
    expect(r.deps.some((d) => d.startsWith('@pnpm/plugin-better-defaults'))).toBe(false);
  });

  it.each(['single7', 'single8'])('%s: single-project lockfile without importers (5.4 / 6.0)', (dir) => {
    expect(summary(dir).deps).toEqual(['chalk@4.1.2', 'ms@2.1.3 dev', 'react-dom@18.3.1']);
  });

  it('normalizeVersion handles every shape seen in real lockfiles', () => {
    expect(normalizeVersion('x', '7.24.6(@babel/core@7.26.10(supports-color@8.1.1))', false)).toEqual({ name: 'x', version: '7.24.6' });
    expect(normalizeVersion('my-chalk', '/chalk@4.1.2', false)).toEqual({ name: 'chalk', version: '4.1.2' });
    expect(normalizeVersion('my-chalk', 'chalk@4.1.2', false)).toEqual({ name: 'chalk', version: '4.1.2' });
    expect(normalizeVersion('my-chalk', '/chalk/4.1.2', true)).toEqual({ name: 'chalk', version: '4.1.2' });
    expect(normalizeVersion('s', '/@scope/s/1.0.0', true)).toEqual({ name: '@scope/s', version: '1.0.0' });
    expect(normalizeVersion('r', '18.2.0_react@18.2.0', true)).toEqual({ name: 'r', version: '18.2.0' });
    expect(normalizeVersion('a', '@scope/a@2.0.0(b@1.0.0)', false)).toEqual({ name: '@scope/a', version: '2.0.0' });
    expect(normalizeVersion('x', '3.2.3(patch_hash=26af)', false)).toEqual({ name: 'x', version: '3.2.3' });
    expect(normalizeVersion('x', 'link:packages/foo', false)).toEqual({ reason: 'link' });
    expect(normalizeVersion('x', 'https://codeload.github.com/watson/ci-info/tar.gz/f43f', false)).toEqual({ reason: 'url' });
  });
});

describe('yarn.lock', () => {
  it('classic v1 with workspaces: two debug versions, dev flag from the root manifest', () => {
    expect(summary('yarn1')).toEqual({
      deps: ['chalk@4.1.2', 'debug@2.6.9', 'debug@4.4.3 dev', 'lodash@4.18.1', 'ms@2.1.3', 'react-dom@18.3.1', 'react@18.3.1'],
      skipped: [],
    });
  });

  it('berry: npm: descriptors, workspace dependency skipped', () => {
    expect(summary('yarn4')).toEqual({
      deps: [
        '@babel/core@7.29.7 dev',
        'chalk@4.1.2',
        'debug@2.6.9',
        'debug@4.4.3 dev',
        'lodash@4.18.1',
        'ms@2.1.3',
        'react-dom@18.3.1',
        'react@18.3.1',
      ],
      skipped: ['@me/foo:workspace'],
    });
  });

  it('splitKeys respects quotes', () => {
    expect(splitKeys('"js-tokens@^3.0.0 || ^4.0.0", lodash@^4.17.0')).toEqual(['js-tokens@^3.0.0 || ^4.0.0', 'lodash@^4.17.0']);
  });

  it('parseYarnV1 maps every key of a multi-key entry', () => {
    const m = parseYarnV1('# yarn lockfile v1\n\nms@2.1.3, ms@^2.1.1:\n  version "2.1.3"\n  resolved "x"\n');
    expect(m.get('ms@^2.1.1')?.version).toBe('2.1.3');
  });
});

describe('bun.lock', () => {
  it('JSONC with trailing commas; workspace-scoped key wins; github dep skipped', () => {
    expect(summary('bunproj')).toEqual({
      deps: [
        '@babel/core@7.24.0 dev',
        'chalk@4.1.2',
        'debug@2.6.9',
        'is-number@7.0.0',
        'lodash@4.18.1',
        'ms@2.1.3 dev',
        'react-dom@18.3.1',
        'react@18.3.1',
        'semver@7.8.5',
      ],
      skipped: ['@me/foo:workspace', 'lodash:git'],
    });
  });

  it('parseJsonc strips comments and trailing commas but not inside strings', () => {
    expect(parseJsonc('{"a": "x // y,}", /* c */ "b": [1, 2,], // t\n}')).toEqual({ a: 'x // y,}', b: [1, 2] });
  });
});

describe('python', () => {
  it('uv.lock: root deps, marker-forked versions, extras and dev groups', () => {
    expect(summary('uvproj').deps).toEqual([
      'beautifulsoup4@4.15.0',
      'pillow@12.3.0',
      'pillow@13.0.0',
      'pytest@9.1.1 dev',
      'python-dateutil@2.9.0.post0',
      'pyyaml@6.0.3',
      'requests@2.34.2',
      'scikit-learn@1.7.2',
      'scikit-learn@1.9.1',
    ]);
  });

  it('uv.lock: editable root package', () => {
    expect(summary('uvproj2').deps).toEqual(['pyyaml@6.0.3']);
  });

  it('poetry.lock + PEP 621 + poetry groups (a dep in main and test stays prod)', () => {
    const deps = summary('poetry').deps;
    expect(deps).toContain('requests@2.34.2');
    expect(deps).toContain('dulwich@1.2.14');
    expect(deps).toContain('pytest@9.1.1 dev');
    expect(deps).toContain('pbs-installer@2026.9.1');
    expect(deps.some((d) => d.startsWith('anyio@'))).toBe(false); // transitive only
  });

  it('Pipfile.lock filtered to names declared in Pipfile', () => {
    const deps = summary('pipenv').deps;
    expect(deps).toContain('pytz@2026.1.post1');
    expect(deps).toContain('click@8.0.3 dev');
    expect(deps.some((d) => d.startsWith('distlib@'))).toBe(false);
  });

  it('requirements.txt: -r include, ===, extras with commas, hashes, markers; ranges and URLs skipped', () => {
    expect(summary('requirements')).toEqual({
      deps: [
        'beautifulsoup4@4.12.3',
        'django@4.2.0',
        'numpy@1.26.4',
        'pillow@10.3.0',
        'python-dateutil@2.9.0.post0',
        'pyyaml@6.0.1',
        'scikit-learn@1.5.0',
      ],
      skipped: ['requests:unpinned', 'urllib3:url'],
    });
  });

  it('requirements files named for dev/test mark deps as dev; wildcard pins are not pins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-req-'));
    writeFileSync(join(dir, 'requirements-dev.txt'), 'pytest==8.3.3\nruff==0.6.*\n');
    const r = parseRequirements(join(dir, 'requirements-dev.txt'), dir, 'requirements-dev.txt');
    expect(r.deps.map((d) => [d.name, d.version, d.dev])).toEqual([['pytest', '8.3.3', true]]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['unpinned']);
  });

  it('pep503 / pep508Name', () => {
    expect(pep503('Typing_Extensions')).toBe('typing-extensions');
    expect(pep508Name("tomli (>=2.0.1,<3.0.0) ; python_version < '3.11'")).toBe('tomli');
    expect(pep508Name('cachecontrol[filecache] (>=0.14.0)')).toBe('cachecontrol');
  });
});

describe('project root and lockfile choice', () => {
  it('walks up from a workspace package to the lockfile', () => {
    expect(findProjectRoot(join(FIX, 'yarn1/packages/foo'))).toBe(join(FIX, 'yarn1'));
  });

  it('packageManager picks the lockfile when several exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-pm-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.5.0' }));
    writeFileSync(join(dir, 'yarn.lock'), '');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(pickNpmLock(dir)).toBe('yarn.lock');
  });

  it('bun.lockb alone produces a note instead of an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-bunb-'));
    writeFileSync(join(dir, 'bun.lockb'), '#!/usr/bin/env bun\nbun-lockfile-format-v0\n');
    const r = readDependencies(dir);
    expect(r.deps).toEqual([]);
    expect(r.notes[0]).toMatch(/bun\.lockb/);
  });
});
