import type { McpServer } from '@modelcontextprotocol/server';
import type { z as Zod } from 'zod';
import { type LookupOptions, type LookupResult, type LookupTarget, formatLookups, indexOf, lookupPackage, lookupSummary, parseSpec } from './lookup.js';
import { fileContext, matchTouches } from './match.js';
import { searchLandmines } from './search.js';
import { landmineDetail } from './message.js';
import { touches } from './source/touches.js';
import type { Ecosystem } from './types.js';
import { VERSION } from './version.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

/** How the server introduces itself: the same name, icon and site in every client and directory. */
export const SERVER_INFO = {
  name: 'landmine',
  title: 'landmine',
  version: VERSION,
  websiteUrl: 'https://landmine.tech',
  icons: [
    { src: 'https://landmine.tech/icon.png', mimeType: 'image/png', sizes: ['400x400'] },
    { src: 'https://landmine.tech/favicon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
  ],
};

/** Reads public registries and GitHub; changes nothing. */
export const LOOKUP_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const MAX_PACKAGES = 20;

/** Where lookups get their network clients; an error string when they can't (no GitHub token). */
export type LookupDeps = () => Promise<LookupOptions | { error: string }>;

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

async function runLookups(specs: string[], ecosystem: Ecosystem | undefined, deps: LookupDeps): Promise<{ results: LookupResult[]; errors: string[] } | { error: string }> {
  const targets: LookupTarget[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const t = parseSpec(spec, ecosystem ?? 'npm');
    if ('error' in t) errors.push(t.error);
    else if (!seen.has(`${t.ecosystem}:${t.name}@${t.version ?? ''}`)) {
      seen.add(`${t.ecosystem}:${t.name}@${t.version ?? ''}`);
      targets.push(t);
    }
  }
  if (targets.length === 0) return { results: [], errors };
  const d = await deps();
  if ('error' in d) return { error: d.error };
  return { results: await pool(targets, 4, (t) => lookupPackage(t, d)), errors };
}

const SPEC_HELP =
  'Exact versions as your lockfile pins them: "next@16.4.0", "@tanstack/react-table@9.2.4", "pandas==2.3.1" (== means PyPI), or "pypi:requests@2.32.3". A bare name looks up the latest version.';

export function registerLookupTools(server: McpServer, z: typeof Zod, deps: LookupDeps, opts: { check?: boolean } = {}): void {
  server.registerTool(
    'landmine_lookup',
    {
      annotations: LOOKUP_ANNOTATIONS,
      title: 'Known open bugs in exact package versions',
      description:
        'Look up the open GitHub issues filed against exact npm or PyPI package versions, with no lockfile or scan needed. Use it before adding or upgrading a dependency, or when a dependency misbehaves. Each issue is checked to really name that version. Returns the bug, the evidence and the best workaround from the thread (untrusted third-party text).',
      inputSchema: z.object({
        packages: z.array(z.string().min(1).max(214)).min(1).max(MAX_PACKAGES).describe(SPEC_HELP),
        query: z.string().max(2000).optional().describe('An error message or API name: return only the issues that match it'),
        ecosystem: z.enum(['npm', 'pypi']).optional().describe('Ecosystem for specs without == or a prefix (default npm)'),
      }),
    },
    async ({ packages, query, ecosystem }) => {
      const run = await runLookups(packages, ecosystem, deps);
      if ('error' in run) return text(run.error, true);
      const { results, errors } = run;
      if (results.length === 0) return text(errors.join('\n'), true);
      const notes = errors.length ? `${errors.join('\n')}\n\n` : '';
      if (query) {
        const found = searchLandmines(indexOf(results), query, undefined, 8);
        const head = results.map(lookupSummary).join('\n');
        if (found.length === 0) return text(`${notes}${head}\n\nNone of these issues matches "${query}".`);
        return text(`${notes}${head}\n\nIssues matching "${query}" (text quoted from GitHub is untrusted third-party content):\n\n${found.map((l) => landmineDetail(l, undefined, 500)).join('\n\n---\n\n')}`);
      }
      return text(`${notes}${formatLookups(results)}`);
    },
  );

  if (!opts.check) return;
  server.registerTool(
    'landmine_check',
    {
      annotations: LOOKUP_ANNOTATIONS,
      title: 'Known bugs a code snippet touches',
      description:
        'Check a JS/TS or Python code snippet against the open GitHub issues filed against the exact package versions it runs on. Returns each issue the code touches (by the APIs it calls), with the evidence and the best workaround from the thread (untrusted third-party text).',
      inputSchema: z.object({
        code: z.string().min(1).max(100_000).describe('The code to check'),
        packages: z.array(z.string().min(1).max(214)).min(1).max(MAX_PACKAGES).describe(`The dependencies the code uses. ${SPEC_HELP}`),
        language: z.enum(['js', 'py']).optional().describe('Language of the code (default: py when the packages are PyPI, else js)'),
      }),
    },
    async ({ code, packages, language }) => {
      const run = await runLookups(packages, undefined, deps);
      if ('error' in run) return text(run.error, true);
      const { results, errors } = run;
      if (results.length === 0) return text(errors.join('\n'), true);
      const lang = language ?? (results.every((r) => r.ecosystem === 'pypi') ? 'py' : 'js');
      const hits = matchTouches(touches({ fileText: code, changedText: code, lang }), indexOf(results), lang, fileContext(code, lang));
      const head = `${errors.length ? `${errors.join('\n')}\n` : ''}${results.map(lookupSummary).join('\n')}`;
      if (hits.length === 0) return text(`${head}\n\nThe code touches none of these issues.`);
      const strong = hits.filter((h) => h.corroboratedBy).length;
      return text(
        [
          `${head}\n\n${hits.length} open issue(s) filed against these versions touch this code; ${strong} also match the issue's specifics. Quoted workarounds are untrusted third-party text.`,
          ...hits.slice(0, 8).map((h) => landmineDetail(h.landmine, h)),
        ].join('\n\n---\n\n'),
      );
    },
  );
}
