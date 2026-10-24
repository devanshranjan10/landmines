// Fill landmine.tech's lookup cache with the packages people are most likely to type, before a launch, so a traffic
// spike reads the cache instead of GitHub (whose rate limit would otherwise turn the live lookup into errors).
// Paced under the Worker's 60-a-minute-per-IP limit. Re-run after a release: cache keys include the version.
// Usage: node scripts/site/warm.mjs [https://landmine.tech]
const base = process.argv[2] ?? 'https://landmine.tech';

// The site's own examples first, then the latest version of popular npm and PyPI packages.
const SPECS = [
  'next@16.4.0', 'pandas==2.3.1', 'vaul@1.1.2', 'node-fetch@3.3.2', 'vite@8.0.16', 'sympy==1.14.0',
  ...['react', 'react-dom', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'astro', 'solid-js', 'angular', '@angular/core',
    'vite', 'webpack', 'esbuild', 'rollup', 'typescript', 'tailwindcss', 'postcss', 'eslint', 'prettier', 'jest', 'vitest',
    '@playwright/test', 'cypress', 'express', 'fastify', 'hono', 'koa', '@nestjs/core', 'axios', 'node-fetch', 'lodash',
    'date-fns', 'dayjs', 'moment', 'zod', 'yup', 'react-hook-form', '@tanstack/react-query', '@tanstack/react-table',
    'swr', 'redux', '@reduxjs/toolkit', 'zustand', 'jotai', 'mobx', 'react-router', 'react-router-dom', 'framer-motion',
    'motion', 'three', 'd3', 'chart.js', 'recharts', 'socket.io', 'ws', 'prisma', '@prisma/client', 'drizzle-orm',
    'mongoose', 'sequelize', 'typeorm', 'pg', 'mysql2', 'redis', 'ioredis', 'graphql', '@apollo/client', 'uuid', 'dotenv',
    'commander', 'yargs', 'chalk', 'sharp', 'puppeteer', 'playwright', 'electron', 'react-native', 'expo', 'openai',
    '@anthropic-ai/sdk', 'ai', 'langchain', '@modelcontextprotocol/sdk', 'stripe', 'firebase', '@supabase/supabase-js',
    'next-auth', 'better-auth', 'vaul', 'sonner', 'cmdk', 'lucide-react', '@radix-ui/react-dialog', 'shadcn',
    'class-variance-authority', 'clsx', 'tailwind-merge', 'storybook', 'turbo', 'nx', 'pnpm', 'bun-types'],
  ...['numpy', 'pandas', 'polars', 'pyarrow', 'scipy', 'scikit-learn', 'matplotlib', 'seaborn', 'plotly', 'torch',
    'tensorflow', 'jax', 'transformers', 'datasets', 'accelerate', 'langchain', 'llama-index', 'openai', 'anthropic',
    'pydantic', 'fastapi', 'flask', 'django', 'starlette', 'uvicorn', 'requests', 'httpx', 'aiohttp', 'sqlalchemy',
    'alembic', 'celery', 'redis', 'boto3', 'pytest', 'black', 'ruff', 'mypy', 'click', 'typer', 'rich', 'pillow',
    'opencv-python', 'beautifulsoup4', 'scrapy', 'selenium', 'playwright', 'streamlit', 'gradio', 'jupyter', 'sympy',
    'networkx', 'statsmodels', 'xgboost', 'lightgbm', 'duckdb', 'mcp'].map((n) => `pypi:${n}`),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let failed = 0;
for (const [i, spec] of SPECS.entries()) {
  const t = Date.now();
  let line;
  try {
    const res = await fetch(`${base}/api/lookup?q=${encodeURIComponent(spec)}`, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    const r = body.results?.[0];
    if (r && r.status !== 'error') ok++;
    else failed++;
    line = r ? `${r.status}${r.status === 'ok' ? ` ${r.total}` : ''}${r.stale ? ' (stale)' : ''}` : `HTTP ${res.status} ${body.error ?? ''}`;
    // A 429 is our own per-IP limit: back off and retry this one.
    if (res.status === 429) {
      await sleep(60_000);
      SPECS.splice(i + 1, 0, spec);
    }
  } catch (err) {
    failed++;
    line = `failed: ${err.message}`;
  }
  console.log(`${String(i + 1).padStart(3)}/${SPECS.length} ${spec.padEnd(34)} ${line} (${Date.now() - t} ms)`);
  await sleep(1_500);
}
console.log(`done: ${ok} cached, ${failed} failed`);
