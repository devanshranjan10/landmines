// False-interrupt track: how often would each arm block an edit to ordinary real code that uses a bench package?
// `fetch` pulls public files that import each package (GitHub code search; only paths and SHAs are committed).
// `check` treats each whole file as newly written against every bench version of its package, with the heuristic
// hook and with trigger cards, and lists every block for labelling.
//   [REALCODE_SET=r2] npx tsx scripts/bench/realcode.ts fetch [perPackage] [page]
//   npx tsx scripts/bench/realcode.ts check
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCards } from '../../src/cards.js';
import { checkFile } from '../../src/match.js';
import { readIndex } from '../../src/store.js';
import type { LandmineIndex } from '../../src/types.js';
import { BENCH, loadTasks } from './lib.js';

// Set R1 (tuning) keeps the original file names; R2 (held out) and later sets get a suffix and their own directory.
const SET = process.env.REALCODE_SET ?? 'r1';
const suffix = SET === 'r1' ? '' : `-${SET}`;
const OUT = join(BENCH, '.work', `realcode${suffix}`);
const MANIFEST = join(BENCH, 'realcode', `manifest${suffix}.json`);
const RESULTS = join(BENCH, 'realcode', `blocks${suffix}.json`);
/** Repos already used by earlier sets, so a held-out set never repeats one. */
function usedRepos(): Set<string> {
  const used = new Set<string>();
  for (const f of SET === 'r1' ? [] : ['manifest.json']) {
    for (const e of JSON.parse(readFileSync(join(BENCH, 'realcode', f), 'utf8')) as Entry[]) used.add(e.repo);
  }
  return used;
}

const QUERIES: Record<string, { query: string; ext: string }> = {
  arrow: { query: '"import arrow" language:python', ext: 'py' },
  axios: { query: `"from 'axios'" language:typescript`, ext: 'ts' },
  'csv-parse': { query: `"from 'csv-parse" language:typescript`, ext: 'ts' },
  'date-fns': { query: `"from 'date-fns'" language:typescript`, ext: 'ts' },
  dayjs: { query: `"from 'dayjs'" language:typescript`, ext: 'ts' },
  'fast-xml-parser': { query: `"from 'fast-xml-parser'" language:typescript`, ext: 'ts' },
  jsonwebtoken: { query: `"from 'jsonwebtoken'" language:typescript`, ext: 'ts' },
  knex: { query: `"from 'knex'" language:typescript`, ext: 'ts' },
  networkx: { query: '"import networkx as nx" language:python', ext: 'py' },
  numpy: { query: '"import numpy as np" language:python', ext: 'py' },
  pandas: { query: '"import pandas as pd" language:python', ext: 'py' },
  papaparse: { query: `"from 'papaparse'" language:typescript`, ext: 'ts' },
  plotly: { query: '"import plotly" language:python', ext: 'py' },
  polars: { query: '"import polars as pl" language:python', ext: 'py' },
  pyarrow: { query: '"import pyarrow as pa" language:python', ext: 'py' },
  pydantic: { query: '"from pydantic import" language:python', ext: 'py' },
  PyYAML: { query: '"import yaml" language:python', ext: 'py' },
  requests: { query: '"import requests" language:python', ext: 'py' },
  rich: { query: '"from rich" language:python', ext: 'py' },
  'scikit-learn': { query: '"from sklearn" language:python', ext: 'py' },
  scipy: { query: '"from scipy" language:python', ext: 'py' },
  seaborn: { query: '"import seaborn as sns" language:python', ext: 'py' },
  semver: { query: `"from 'semver'" language:typescript`, ext: 'ts' },
  yaml: { query: `"from 'yaml'" language:typescript`, ext: 'ts' },
  zod: { query: `"from 'zod'" language:typescript`, ext: 'ts' },
};

interface Entry {
  pkg: string;
  repo: string;
  path: string;
  sha: string;
  url: string;
}

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

function fileFor(e: Entry, ext: string): string {
  const name = `${e.repo.replace('/', '__')}__${e.path.replace(/[/\\]/g, '__')}`;
  return join(OUT, e.pkg, /\.\w+$/.test(name) ? name : `${name}.${ext}`);
}

function fetch(perPackage: number, page: number): void {
  const manifest: Entry[] = [];
  const used = usedRepos();
  for (const [pkg, q] of Object.entries(QUERIES)) {
    let raw = '';
    for (let attempt = 0; attempt < 4 && !raw; attempt++) {
      try {
        raw = execFileSync('gh', ['api', '-X', 'GET', 'search/code', '-f', `q=${q.query}`, '-f', 'per_page=50', '-f', `page=${page}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        sleep(15000); // code search returns transient 503s
      }
    }
    if (!raw) {
      console.error(`${pkg}: search failed, skipped`);
      continue;
    }
    const items = (JSON.parse(raw) as { items: Array<{ path: string; sha: string; html_url: string; repository: { full_name: string; fork: boolean } }> }).items;
    const repos = new Set<string>();
    let got = 0;
    for (const it of items) {
      if (got >= perPackage || it.repository.fork || repos.has(it.repository.full_name) || used.has(it.repository.full_name)) continue;
      if (/test|spec|example|tutorial|demo|\.d\.ts$/i.test(it.path)) continue;
      const blob = JSON.parse(execFileSync('gh', ['api', `repos/${it.repository.full_name}/git/blobs/${it.sha}`], { encoding: 'utf8' })) as { content: string; size: number };
      if (blob.size > 200_000) continue;
      repos.add(it.repository.full_name);
      const e: Entry = { pkg, repo: it.repository.full_name, path: it.path, sha: it.sha, url: it.html_url };
      const file = fileFor(e, q.ext);
      mkdirSync(join(OUT, pkg), { recursive: true });
      writeFileSync(file, Buffer.from(blob.content, 'base64'));
      manifest.push(e);
      got++;
    }
    console.error(`${pkg}: ${got} files`);
    sleep(7000); // code search: 10 requests a minute
  }
  mkdirSync(join(MANIFEST, '..'), { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.error(`${manifest.length} files`);
}

/** The bench's indexes, one per package version, as built by gen-cards (bench/.work/cardgen). */
function indexes(): Array<{ pkg: string; version: string; index: LandmineIndex }> {
  const out: Array<{ pkg: string; version: string; index: LandmineIndex }> = [];
  const seen = new Set<string>();
  for (const t of loadTasks()) {
    const key = `${t.ecosystem}/${t.package}@${t.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const index = readIndex(join(BENCH, '.work', 'cardgen', key.replace(/[/@]/g, '_')));
    if (!index) throw new Error(`no index for ${key}: run gen-cards first`);
    index.landmines = index.landmines.filter((l) => l.package === t.package && l.version === t.version);
    out.push({ pkg: t.package, version: t.version, index });
  }
  return out;
}

function check(): void {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Entry[];
  const all = indexes();
  const blocks: Array<Record<string, unknown>> = [];
  const filesBlocked = { hook: new Set<string>(), cards: new Set<string>() };
  let pairs = 0;
  for (const e of manifest) {
    const file = fileFor(e, QUERIES[e.pkg]?.ext ?? 'py');
    if (!existsSync(file)) continue;
    for (const { pkg, version, index } of all.filter((x) => x.pkg === e.pkg)) {
      pairs++;
      for (const arm of ['hook', 'cards'] as const) {
        const idx = structuredClone(index);
        if (arm === 'cards') loadCards(idx, join(BENCH, 'fixtures', 'cards'));
        for (const h of checkFile(file, idx).filter((x) => x.corroboratedBy)) {
          filesBlocked[arm].add(`${e.repo}/${e.path}@${version}`);
          blocks.push({
            arm,
            file: `${e.repo}/${e.path}`,
            url: e.url,
            pkg,
            version,
            issue: h.landmine.id,
            symbol: h.symbol,
            via: h.corroboratedBy,
            condition: h.landmine.card?.condition ?? h.landmine.issue.title,
          });
        }
      }
    }
  }
  writeFileSync(RESULTS, `${JSON.stringify({ files: manifest.length, filePackageVersionPairs: pairs, hookFilesBlocked: filesBlocked.hook.size, cardsFilesBlocked: filesBlocked.cards.size, blocks }, null, 2)}\n`);
  console.log(`${manifest.length} files, ${pairs} file × version pairs`);
  console.log(`hook:  ${filesBlocked.hook.size} pairs would block (${blocks.filter((b) => b.arm === 'hook').length} blocks)`);
  console.log(`cards: ${filesBlocked.cards.size} pairs would block (${blocks.filter((b) => b.arm === 'cards').length} blocks)`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'fetch') fetch(Number(arg ?? 6), Number(process.argv[4] ?? 1));
else if (cmd === 'check') check();
else console.error('usage: realcode.ts fetch [perPackage] | check');
