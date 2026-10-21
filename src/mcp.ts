import { isAbsolute, relative, resolve } from 'node:path';
import { readFileOrUndefined } from './hook/payload.js';
import type { McpServer } from '@modelcontextprotocol/server';
import { checkFile, fileContext, matchTouches } from './match.js';
import { landmineDetail } from './message.js';
import { cardDisarms, isArmed } from './policy.js';
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

/** Every tool only reads the local index (and, for landmine_check, a file in the project): no side effects, no network. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Rank issues by how many of the query's words appear in their title, labels and symbols. */
/** Words in almost every error message or issue title: matching them says nothing. */
const SEARCH_STOPWORDS = new Set(
  'the and for with when not does doesn from that this have has get set use using used error errors bug issue function functions method value values type types return returns returned null undefined true false cannot can can\'t work works working broken wrong fails failed failing throw throws thrown when after before new old version versions call called calls object objects string number data file files code'.split(
    ' ',
  ),
);

export function searchLandmines(index: LandmineIndex, query: string, pkg?: string, limit = 5): Landmine[] {
  const words = new Set((query.match(TOKEN) ?? []).map((w) => w.toLowerCase()).filter((w) => !SEARCH_STOPWORDS.has(w)));
  if (words.size === 0) return [];
  const seen = new Set<string>();
  const scored: Array<{ l: Landmine; score: number }> = [];
  for (const l of index.landmines) {
    if ((pkg && l.package !== pkg) || !reportable(l) || seen.has(l.id)) continue;
    seen.add(l.id);
    // Title, labels, symbols, and the trigger card's APIs and condition (the card's wording is often what an error says).
    const cardText = l.card && !cardDisarms(l) ? `${l.card.apis.join(' ')} ${l.card.condition}` : '';
    const hay = new Set(
      [...(`${l.issue.title} ${l.issue.labels.join(' ')} ${cardText}`.match(TOKEN) ?? []), ...l.symbols.flatMap((s) => s.name.split(/[./]/)), ...(l.card?.apis.flatMap((a) => a.split('.')) ?? [])].map((w) => w.toLowerCase()),
    );
    let score = 0;
    for (const w of words) if (hay.has(w)) score++;
    if (score > 0) scored.push({ l, score: score + (l.evidence.strength === 'strong' ? 0.5 : 0) + (isArmed(l) ? 0.5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || b.l.issue.reactions - a.l.issue.reactions);
  // Keep results that match at least half as many query words as the best one: a single shared word is noise.
  const best = scored[0]?.score ?? 0;
  return scored
    .filter((s) => s.score >= Math.max(1, best / 2))
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
      annotations: READ_ONLY,
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
        const base = resolve(opts.root ?? opts.cwd ?? process.cwd());
        const path = isAbsolute(file) ? resolve(file) : resolve(base, file);
        // Only files in this project: the tool is for the code being worked on, not arbitrary paths on the machine.
        const rel = relative(base, path);
        if (rel.startsWith('..') || isAbsolute(rel)) return text(`${file} is outside the project (${base}); pass a file inside it, or the code itself.`, true);
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
      annotations: READ_ONLY,
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
      annotations: READ_ONLY,
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
      return text(
        chosen
          .map((l) => {
            const condition = l.card && !cardDisarms(l) ? `\n  ${l.card.condition}` : '';
            return `${l.id} (${l.package}@${l.version}) ${l.issue.title}${condition}\n  ${l.issue.url}`;
          })
          .join('\n'),
      );
    },
  );

  return server;
}

export async function serveStdio(opts: McpOptions = {}): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  await (await createMcpServer(opts)).connect(new StdioServerTransport());
}
