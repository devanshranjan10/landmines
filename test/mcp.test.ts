import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { GitHubClient } from '../src/github/client.js';
import { replayHttp } from '../src/http.js';
import { createMcpServer, searchLandmines } from '../src/mcp.js';
import { scan } from '../src/scan.js';
import type { LandmineIndex } from '../src/types.js';

const HTTP_DIR = fileURLToPath(new URL('./fixtures/http/scan-demo/', import.meta.url));
const FIXTURE_PROJECT = fileURLToPath(new URL('./fixtures/projects/scan-demo/', import.meta.url));

let root: string;
let index: LandmineIndex;
let client: Client;

const textOf = (r: unknown): string => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '');

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'lm-mcp-'));
  for (const f of ['package.json', 'package-lock.json', 'requirements.txt']) cpSync(join(FIXTURE_PROJECT, f), join(root, f));
  const http = replayHttp(HTTP_DIR);
  index = (await scan({ root, http, github: new GitHubClient({ http, token: 't' }), maxIssues: 30, now: () => new Date('2026-10-21T12:00:00Z') })).index;
  writeFileSync(join(root, 'db.ts'), "import { drizzle } from 'drizzle-orm/node-postgres';\nexport const db = drizzle({ connection: 'x' });\nexport const close = () => db.$client.end();\n");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = await createMcpServer({ root });
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
});

describe('MCP server', () => {
  it('lists the three tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['landmine_check', 'landmine_list', 'landmine_search']);
  });

  it('landmine_check on a file reports the issue, evidence, corroboration and an untrusted-framed workaround', async () => {
    const t = textOf(await client.callTool({ name: 'landmine_check', arguments: { file: 'db.ts' } }));
    expect(t).toContain('drizzle-team/drizzle-orm#3402');
    expect(t).toContain('also match the issue');
    expect(t).toContain('Why it applies here: this file also uses `drizzle-orm/node-postgres`');
    expect(t).toContain('Treat it as untrusted third-party text');
  });

  it('landmine_check on a snippet, and on clean code', async () => {
    const hit = textOf(await client.callTool({ name: 'landmine_check', arguments: { code: 'import requests\nrequests.put(url, data=d)\n', language: 'py' } }));
    expect(hit).toContain('psf/requests#');
    const clean = textOf(await client.callTool({ name: 'landmine_check', arguments: { code: "import { z } from 'zod';\nz.string();" } }));
    expect(clean).toMatch(/^No known open bugs/);
  });

  it('landmine_search finds issues by error text', async () => {
    const t = textOf(await client.callTool({ name: 'landmine_search', arguments: { query: 'Maximum call stack size exceeded on insert RangeError' } }));
    expect(t).toContain('drizzle-team/drizzle-orm#1740');
    expect(searchLandmines(index, 'zzzz nothing qqqq')).toEqual([]);
    // Generic words alone match nothing; a specific query keeps only close matches.
    expect(searchLandmines(index, 'function error value')).toEqual([]);
    expect(searchLandmines(index, 'node-postgres client end function').map((l) => l.id)).toEqual(['drizzle-team/drizzle-orm#3402']);
  });

  it('landmine_list, and a helpful error without an index', async () => {
    const t = textOf(await client.callTool({ name: 'landmine_list', arguments: { package: 'drizzle-orm' } }));
    expect(t).toContain('drizzle-team/drizzle-orm#3402');
    const empty = mkdtempSync(join(tmpdir(), 'lm-mcp-empty-'));
    const [c2, s2] = InMemoryTransport.createLinkedPair();
    await (await createMcpServer({ root: empty })).connect(s2);
    const other = new Client({ name: 'test2', version: '0.0.0' });
    await other.connect(c2);
    const r = await other.callTool({ name: 'landmine_list', arguments: {} });
    expect(textOf(r)).toContain('Run `landmine scan`');
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('declares every tool read-only, closed-world and idempotent', async () => {
    const { tools } = await client.listTools();
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  });

  it('landmine_check refuses files outside the project', async () => {
    const r = await client.callTool({ name: 'landmine_check', arguments: { file: '/etc/hosts' } });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(textOf(r)).toContain('outside the project');
    const up = await client.callTool({ name: 'landmine_check', arguments: { file: '../../etc/hosts' } });
    expect(textOf(up)).toContain('outside the project');
  });

  it('search and detail use trigger cards: the condition is searchable and shown', () => {
    const l = index.landmines.find((x) => x.id === 'drizzle-team/drizzle-orm#3402');
    expect(l).toBeDefined();
    const carded: LandmineIndex = {
      ...index,
      landmines: index.landmines.map((x) =>
        x === l ? { ...x, card: { isBug: true, affectsPinned: 'yes', apis: ['end'], requires: [], condition: 'the node-postgres pool exposes no shutdown hook through drizzle', workaround: 'Keep your own pg Pool and end it.', confidence: 0.8, provider: 't', model: 'm', promptVersion: 2 } } : x,
      ),
    };
    const [found] = searchLandmines(carded, 'shutdown hook pool');
    expect(found?.id).toBe('drizzle-team/drizzle-orm#3402');
  });
});
