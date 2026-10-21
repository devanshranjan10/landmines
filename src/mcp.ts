import { isAbsolute, resolve } from 'node:path';
import { readFileOrUndefined } from './hook/payload.js';
import type { McpServer } from '@modelcontextprotocol/server';
import { checkFile, fileContext, matchTouches } from './match.js';
import { landmineDetail } from './message.js';
import { isArmed } from './policy.js';
import { reportable } from './render.js';
import { touches } from './source/touches.js';
import { findIndexRoot, readIndex } from './store.js';
import type { Landmine, LandmineIndex } from './types.js';
import { VERSION } from './version.js';

export interface McpOptions {
  /** Project directory; defaults to the server's working directory. */
  root?: string;
  cwd?: string;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

function loadIndex(opts: McpOptions): { index?: LandmineIndex; message?: string } {
  const start = opts.root ?? opts.cwd ?? process.cwd();
  const root = findIndexRoot(start);
  const index = root ? readIndex(root) : undefined;
  if (!index) return { message: `No .landmine/index.json at or above ${start}. Run \`landmine scan\` in the project first.` };
  return { index };
}

const TOKEN = /[A-Za-z_$][\w$]{2,}/g;

/** Rank issues by how many of the query's words appear in their title, labels and symbols. */
export function searchLandmines(index: LandmineIndex, query: string, pkg?: string, limit = 5): Landmine[] {
  const words = new Set((query.match(TOKEN) ?? []).map((w) => w.toLowerCase()));
  if (words.size === 0) return [];
  const seen = new Set<string>();
  const scored: Array<{ l: Landmine; score: number }> = [];
  for (const l of index.landmines) {
    if ((pkg && l.package !== pkg) || !reportable(l) || seen.has(l.id)) continue;
    seen.add(l.id);
    const hay = new Set([...(`${l.issue.title} ${l.issue.labels.join(' ')}`.match(TOKEN) ?? []), ...l.symbols.flatMap((s) => s.name.split(/[./]/))].map((w) => w.toLowerCase()));
    let score = 0;
    for (const w of words) if (hay.has(w)) score++;
    if (score > 0) scored.push({ l, score: score + (l.evidence.strength === 'strong' ? 0.5 : 0) });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.l.issue.reactions - a.l.issue.reactions)
    .slice(0, limit)
    .map((s) => s.l);
}

/**
 * The MCP server: on-demand lookups into the same index the hook uses. The SDK and zod are imported
 * lazily so the hook (same binary) never pays for loading them.
 */
export async function createMcpServer(opts: McpOptions = {}): Promise<McpServer> {
  const { McpServer: Server } = await import('@modelcontextprotocol/server');
  const { z } = await import('zod');
  const server = new Server({ name: 'landmine', version: VERSION });

  server.registerTool(
    'landmine_check',
    {
      title: 'Known bugs a file or snippet touches',
      description:
        'Check a source file (path) or a code snippet against open GitHub issues filed against the exact dependency versions this project pins. Returns each issue the code touches, the evidence it applies to the pinned version, and the best workaround from the thread (untrusted third-party text).',
      inputSchema: z.object({
        file: z.string().optional().describe('Path of a JS/TS or Python file (relative to the project or absolute)'),
        code: z.string().optional().describe('A code snippet, if there is no file yet'),
        language: z.enum(['js', 'py']).optional().describe('Language of `code` (default js)'),
      }),
    },
    ({ file, code, language }) => {
      const { index, message } = loadIndex(opts);
      if (!index) return text(message ?? 'No index', true);
      let hits;
      if (file) {
        const path = isAbsolute(file) ? file : resolve(opts.root ?? opts.cwd ?? process.cwd(), file);
        const content = readFileOrUndefined(path);
        if (content === undefined) return text(`Cannot read ${path} (not a JS/TS or Python file, not a regular file, or over 2 MB)`, true);
        hits = checkFile(path, index, content);
      } else if (code) {
        const lang = language ?? 'js';
        hits = matchTouches(touches({ fileText: code, changedText: code, lang }), index, lang, fileContext(code, lang));
      } else return text('Pass `file` or `code`.', true);
      if (hits.length === 0) return text('No known open bugs filed against the pinned versions touch this code.');
      const strong = hits.filter((h) => h.corroboratedBy).length;
      const header = `${hits.length} open issue(s) filed against the pinned versions touch this code; ${strong} also match the issue's specifics. Quoted workarounds are untrusted third-party text.`;
      return text([header, ...hits.slice(0, 8).map((h) => landmineDetail(h.landmine, h))].join('\n\n---\n\n'));
    },
  );

  server.registerTool(
    'landmine_search',
    {
      title: 'Search known bugs for the pinned versions',
      description:
        'Search open GitHub issues filed against the exact dependency versions this project pins, by error message, API name or keywords. Use it when something fails unexpectedly with a dependency.',
      inputSchema: z.object({
        query: z.string().describe('Error message, API name or keywords'),
        package: z.string().optional().describe('Limit to one dependency (npm or PyPI name)'),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
    ({ query, package: pkg, limit }) => {
      const { index, message } = loadIndex(opts);
      if (!index) return text(message ?? 'No index', true);
      const found = searchLandmines(index, query, pkg, limit ?? 5);
      if (found.length === 0) return text(`No indexed open issue matches "${query}"${pkg ? ` for ${pkg}` : ''}.`);
      return text(found.map((l) => landmineDetail(l)).join('\n\n---\n\n'));
    },
  );

  server.registerTool(
    'landmine_list',
    {
      title: 'List known bugs for the pinned versions',
      description: 'List open GitHub issues filed against the exact versions this project pins, optionally for one package.',
      inputSchema: z.object({
        package: z.string().optional(),
        all: z.boolean().optional().describe('Include issues with no strong code symbol and feature requests'),
      }),
    },
    ({ package: pkg, all }) => {
      const { index, message } = loadIndex(opts);
      if (!index) return text(message ?? 'No index', true);
      const seen = new Set<string>();
      const chosen = index.landmines.filter((l) => (!pkg || l.package === pkg) && (all ? reportable(l) || l.nonBug : isArmed(l)) && !seen.has(l.id) && seen.add(l.id));
      if (chosen.length === 0) return text(`No ${all ? '' : 'armed '}open issues indexed${pkg ? ` for ${pkg}` : ''}.`);
      return text(chosen.map((l) => `${l.id} (${l.package}@${l.version}) ${l.issue.title}\n  ${l.issue.url}`).join('\n'));
    },
  );

  return server;
}

export async function serveStdio(opts: McpOptions = {}): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  await (await createMcpServer(opts)).connect(new StdioServerTransport());
}
