/**
 * Fetch real source files that import given packages from public GitHub repos (code search),
 * for the hook-level accuracy check. Writes files under <out>/<package>/ and a manifest.
 *
 *   npx tsx scripts/fetch-real-files.ts /tmp/lm-realcode eval/realcode/manifest.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out = '/tmp/lm-realcode', manifestPath = 'eval/realcode/manifest.json'] = process.argv.slice(2);
const PER_PACKAGE = 3;
const targets: Array<{ pkg: string; query: string; ext: string }> = [
  // held-out A
  { pkg: 'pandas', query: '"import pandas as pd" language:python', ext: 'py' },
  { pkg: 'numpy', query: '"import numpy as np" language:python', ext: 'py' },
  { pkg: 'matplotlib', query: '"import matplotlib.pyplot as plt" language:python', ext: 'py' },
  { pkg: 'polars', query: '"import polars as pl" language:python', ext: 'py' },
  { pkg: 'celery', query: '"from celery import" language:python', ext: 'py' },
  { pkg: 'pytest', query: '"import pytest" language:python', ext: 'py' },
  { pkg: 'langchain', query: '"from langchain" language:python', ext: 'py' },
  { pkg: 'dayjs', query: '"from \'dayjs\'" language:typescript', ext: 'ts' },
  { pkg: 'jsonwebtoken', query: '"from \'jsonwebtoken\'" language:typescript', ext: 'ts' },
  { pkg: 'socket.io', query: '"from \'socket.io\'" language:typescript', ext: 'ts' },
  { pkg: 'vue', query: '"from \'vue\'" language:typescript', ext: 'ts' },
  // held-out B
  { pkg: 'torch', query: '"import torch" language:python', ext: 'py' },
  { pkg: 'seaborn', query: '"import seaborn as sns" language:python', ext: 'py' },
  { pkg: 'plotly', query: '"import plotly.express as px" language:python', ext: 'py' },
  { pkg: 'scipy', query: '"from scipy" language:python', ext: 'py' },
  { pkg: 'scikit-learn', query: '"from sklearn" language:python', ext: 'py' },
  { pkg: 'click', query: '"import click" language:python', ext: 'py' },
  { pkg: 'pyyaml', query: '"import yaml" language:python', ext: 'py' },
  { pkg: 'knex', query: '"from \'knex\'" language:typescript', ext: 'ts' },
  { pkg: 'sequelize', query: '"from \'sequelize\'" language:typescript', ext: 'ts' },
];

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
const manifest: Array<{ pkg: string; repo: string; path: string; sha: string; url: string; file: string }> = [];
for (const t of targets) {
  const raw = execFileSync('gh', ['api', '-X', 'GET', 'search/code', '-f', `q=${t.query}`, '-f', 'per_page=15'], { encoding: 'utf8' });
  const items = (JSON.parse(raw) as { items: Array<{ path: string; sha: string; html_url: string; repository: { full_name: string; fork: boolean } }> }).items;
  const seenRepos = new Set<string>();
  let got = 0;
  for (const it of items) {
    if (got >= PER_PACKAGE || it.repository.fork || seenRepos.has(it.repository.full_name) || /test|example|tutorial|demo/i.test(it.path)) continue;
    seenRepos.add(it.repository.full_name);
    const blob = JSON.parse(execFileSync('gh', ['api', `repos/${it.repository.full_name}/git/blobs/${it.sha}`], { encoding: 'utf8' })) as { content: string; size: number };
    if (blob.size > 200_000) continue;
    const dir = join(out, t.pkg);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${it.repository.full_name.replace('/', '__')}__${it.path.replace(/[/\\]/g, '__')}`);
    writeFileSync(file, Buffer.from(blob.content, 'base64'));
    manifest.push({ pkg: t.pkg, repo: it.repository.full_name, path: it.path, sha: it.sha, url: it.html_url, file });
    got++;
  }
  console.error(`${t.pkg}: ${got} files`);
  sleep(7000); // code search: 10 requests/minute
}
mkdirSync(join(manifestPath, '..'), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest.map(({ file: _f, ...m }) => m), null, 2)}\n`);
console.error(`${manifest.length} files`);
