import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { GitHubClient } from './github/client.js';
import { findToken } from './github/token.js';
import { type Http, liveHttp, recordingHttp, replayHttp } from './http.js';
import { findProjectRoot } from './lockfiles/index.js';
import { checkFile } from './match.js';
import { humanLandmine } from './message.js';
import { isArmed } from './policy.js';
import { renderScanSummary, wantsColor } from './render.js';
import { scan } from './scan.js';
import { findIndexRoot, readIndex } from './store.js';
import type { LandmineIndex } from './types.js';
import { VERSION } from './version.js';

/**
 * Test and fixture hooks (not user-facing): LANDMINE_HTTP_REPLAY=<dir> serves recorded responses,
 * LANDMINE_HTTP_RECORD=<dir> records live ones.
 */
function httpFromEnv(env: NodeJS.ProcessEnv): { http: Http; replay: boolean } {
  if (env.LANDMINE_HTTP_REPLAY) return { http: replayHttp(env.LANDMINE_HTTP_REPLAY), replay: true };
  if (env.LANDMINE_HTTP_RECORD) return { http: recordingHttp(env.LANDMINE_HTTP_RECORD), replay: false };
  return { http: liveHttp, replay: false };
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new InvalidArgumentError('expected an integer from 1 to 1000');
  return n;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

function requireRoot(dir: string | undefined): string {
  const root = findProjectRoot(dir ?? process.cwd());
  if (!root) throw new CliError('No supported lockfile found here or in any parent directory (package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock, uv.lock, poetry.lock, Pipfile.lock, requirements*.txt).');
  return root;
}

export function buildProgram(env: NodeJS.ProcessEnv = process.env): Command {
  const program = new Command();
  program
    .name('landmine')
    .description('Open GitHub issues filed against your exact dependency versions, surfaced before your coding agent edits the code that hits them.')
    .version(VERSION, '-v, --version')
    .showHelpAfterError();

  program
    .command('scan')
    .description('Find open issues filed against the exact versions in your lockfiles and write .landmine/index.json')
    .option('-r, --root <dir>', 'project directory (default: nearest directory with a lockfile)')
    .option('-m, --max-issues <n>', 'most issues to fetch per package version', positiveInt, 100)
    .option('--refresh', 'ignore cached results younger than 24h')
    .option('--prod', 'skip dev/test dependencies')
    .option('--json', 'print the index as JSON instead of a summary')
    .option('-q, --quiet', 'no progress output')
    .action(async (opts: { root?: string; maxIssues: number; refresh?: boolean; prod?: boolean; json?: boolean; quiet?: boolean }) => {
      const root = requireRoot(opts.root);
      const { http, replay } = httpFromEnv(env);
      const token = replay ? { token: 'replay', source: 'GITHUB_TOKEN' as const } : await findToken(env);
      if (!token) {
        throw new CliError(
          'landmine scan needs a GitHub token (GitHub search and GraphQL require one). Set GITHUB_TOKEN or GH_TOKEN, or log in with `gh auth login`. A token with no scopes is enough for public repos.',
        );
      }
      const log = opts.quiet || opts.json ? () => {} : (m: string) => process.stderr.write(`${m}\n`);
      const github = new GitHubClient({ http, token: token.token, log });
      log(`Scanning ${relative(process.cwd(), root) || '.'} (token from ${token.source})`);
      const result = await scan({ root, http, github, maxIssues: opts.maxIssues, refresh: Boolean(opts.refresh), prod: Boolean(opts.prod), log });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.index, null, 2)}\n`);
        return;
      }
      const rel = result.indexFile ? relative(process.cwd(), result.indexFile) : undefined;
      const indexFile = rel && !rel.startsWith('..') ? rel : result.indexFile;
      process.stdout.write(
        `\n${renderScanSummary(result.index, { skipped: result.skipped, notes: result.notes, reused: result.reused, ...(indexFile ? { indexFile } : {}) }, { color: wantsColor(process.stdout, env) })}`,
      );
    });

  program
    .command('check')
    .description('Report landmines that whole files touch (as if every line were being edited)')
    .argument('<files...>', 'JS/TS or Python files')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: nearest one above each file)')
    .option('--json', 'machine-readable output')
    .option('--exit-code', 'exit with status 1 when anything matches (for CI)')
    .action((files: string[], opts: { root?: string; json?: boolean; exitCode?: boolean }) => {
      const color = { color: wantsColor(process.stdout, env) };
      const results: Array<{ file: string; hits: ReturnType<typeof checkFile> }> = [];
      for (const file of files) {
        const abs = resolve(file);
        if (!existsSync(abs)) throw new CliError(`No such file: ${file}`);
        const index = loadIndex(opts.root ?? dirname(abs));
        results.push({ file, hits: checkFile(abs, index) });
      }
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify(results.map((r) => ({ file: r.file, hits: r.hits.map((h) => ({ symbol: h.symbol, score: h.score, id: h.landmine.id, landmine: h.landmine })) })), null, 2)}\n`,
        );
      } else {
        for (const r of results) {
          if (r.hits.length === 0) {
            process.stdout.write(`${r.file}: no known open bugs touched\n`);
            continue;
          }
          process.stdout.write(`${r.file}\n`);
          for (const h of r.hits) process.stdout.write(`  ${humanLandmine(h.landmine, color, h.symbol).replace(/\n/g, '\n  ')}\n`);
        }
      }
      if (opts.exitCode && results.some((r) => r.hits.length > 0)) process.exitCode = 1;
    });

  program
    .command('list')
    .description('Show indexed landmines (default: the ones the hook can fire on)')
    .argument('[package]', 'only this package')
    .option('-r, --root <dir>', 'project with .landmine/index.json')
    .option('-a, --all', 'include issues with no strong symbol or with weak version evidence')
    .option('--json', 'machine-readable output')
    .action((pkg: string | undefined, opts: { root?: string; all?: boolean; json?: boolean }) => {
      const index = loadIndex(opts.root ?? process.cwd());
      const chosen = index.landmines.filter((l) => (!pkg || l.package === pkg) && (opts.all || isArmed(l)));
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(chosen, null, 2)}\n`);
        return;
      }
      const color = { color: wantsColor(process.stdout, env) };
      if (chosen.length === 0) {
        process.stdout.write(`No ${opts.all ? '' : 'armed '}landmines${pkg ? ` for ${pkg}` : ''} in the index.${opts.all ? '' : ' Try --all.'}\n`);
        return;
      }
      for (const l of chosen) process.stdout.write(`${humanLandmine(l, color)}\n`);
      const hidden = index.landmines.filter((l) => (!pkg || l.package === pkg) && !isArmed(l)).length;
      if (!opts.all && hidden) process.stdout.write(`\n${hidden} more without a strong symbol or with weak evidence: landmine list --all\n`);
    });

  return program;
}

function loadIndex(start: string): LandmineIndex {
  const root = findIndexRoot(start);
  const index = root ? readIndex(root) : undefined;
  if (!index) throw new CliError('No .landmine/index.json found. Run `landmine scan` in your project first.');
  return index;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    await buildProgram(env).parseAsync(argv);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`landmine: ${message}\n`);
    return err instanceof CliError ? err.exitCode : 1;
  }
}

process.exitCode = await main(process.argv);
