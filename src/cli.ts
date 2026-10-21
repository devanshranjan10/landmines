import { existsSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { GitHubClient } from './github/client.js';
import { findToken } from './github/token.js';
import { type Http, liveHttp, recordingHttp, replayHttp } from './http.js';
import { findProjectRoot } from './lockfiles/index.js';
import { HARNESSES, type Harness } from './hook/payload.js';
import type { HookMode } from './hook/respond.js';
import { runHook } from './hook/run.js';
import { hookCommand, install, installMcp, mcpCommand, preflight, uninstall } from './install.js';
import { checkFile } from './match.js';
import { humanLandmine } from './message.js';
import { isArmed } from './policy.js';
import { renderScanSummary, wantsColor } from './render.js';
import { DEFAULT_MAX_RULES, RULES_TARGETS, renderRules, writeRules } from './rules.js';
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
    .option('--offline', 're-analyse cached data of any age; no network, no token needed')
    .option('--prod', 'skip dev/test dependencies')
    .option('--json', 'print the index as JSON instead of a summary')
    .option('-q, --quiet', 'no progress output')
    .action(async (opts: { root?: string; maxIssues: number; refresh?: boolean; offline?: boolean; prod?: boolean; json?: boolean; quiet?: boolean }) => {
      const root = requireRoot(opts.root);
      const { http, replay } = httpFromEnv(env);
      const token = replay || opts.offline ? { token: 'offline', source: 'GITHUB_TOKEN' as const } : await findToken(env);
      if (!token) {
        throw new CliError(
          'landmine scan needs a GitHub token (GitHub search and GraphQL require one). Set GITHUB_TOKEN or GH_TOKEN, or log in with `gh auth login`. A token with no scopes is enough for public repos.',
        );
      }
      const log = opts.quiet || opts.json ? () => {} : (m: string) => process.stderr.write(`${m}\n`);
      const github = new GitHubClient({ http, token: token.token, log });
      log(`Scanning ${relative(process.cwd(), root) || '.'} ${opts.offline ? '(offline, cached data only)' : `(token from ${token.source})`}`);
      const result = await scan({ root, http, github, maxIssues: opts.maxIssues, refresh: Boolean(opts.refresh), offline: Boolean(opts.offline), prod: Boolean(opts.prod), log });
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
          `${JSON.stringify(results.map((r) => ({ file: r.file, hits: r.hits.map((h) => ({ symbol: h.symbol, score: h.score, id: h.landmine.id, blocks: Boolean(h.corroboratedBy), corroboratedBy: h.corroboratedBy ?? null, landmine: h.landmine })) })), null, 2)}\n`,
        );
      } else {
        for (const r of results) {
          if (r.hits.length === 0) {
            process.stdout.write(`${r.file}: no known open bugs touched\n`);
            continue;
          }
          process.stdout.write(`${r.file}\n`);
          for (const h of r.hits) process.stdout.write(`  ${humanLandmine(h.landmine, color, h.symbol, h).replace(/\n/g, '\n  ')}\n`);
        }
      }
      if (opts.exitCode && results.some((r) => r.hits.length > 0)) process.exitCode = 1;
    });

  program
    .command('hook')
    .description('Hook entry point: reads the harness payload on stdin, blocks an edit once per known bug (always exits 0)')
    .option('--mode <mode>', 'block (deny once, then allow the retry) or warn (add context, never block)', modeArg, 'block')
    .option('--harness <name>', `force the payload format (${HARNESSES.join(', ')}); default: detect`, harnessArg)
    .option('--heads-up', 'in block mode, also pass weaker (uncorroborated) matches to the agent as non-blocking context')
    .action(async (opts: { mode: HookMode; harness?: Harness | 'all'; headsUp?: boolean }) => {
      if (process.stdin.isTTY) {
        process.stderr.write('landmine hook reads a hook payload on stdin; it is meant to be run by Claude Code, Codex, Cursor or Gemini CLI. See `landmine install`.\n');
        return;
      }
      try {
        const input = await readStdin();
        const harness = opts.harness === 'all' ? undefined : opts.harness;
        const result = runHook(input, { mode: opts.mode, env, ...(harness ? { harness } : {}), ...(opts.headsUp ? { headsUp: true } : {}) });
        if (result.stdout) process.stdout.write(`${result.stdout}\n`);
        if (env.LANDMINE_DEBUG === '1') process.stderr.write(`landmine: ${result.decision}${result.reason ? ` (${result.reason})` : ''}\n`);
      } catch {
        // Never get in the agent's way.
      }
    });

  program
    .command('install')
    .description('Wire the hook into this project (default: Claude Code, which Cursor also reads)')
    .option('-r, --root <dir>', 'project directory (default: nearest directory with a lockfile)')
    .option('--harness <name>', `${HARNESSES.join(', ')} or all`, harnessArg, 'claude')
    .option('--mode <mode>', 'block (interrupt once on a strong match) or warn (never block; pass every match as context)', modeArg, 'block')
    .option('--heads-up', 'block mode: also pass weaker matches to the agent as non-blocking context')
    .option('--command <cmd>', 'exact command the harness should run (default: this landmine install)')
    .option('--mcp', 'also add the landmine MCP server to .mcp.json (Claude Code project scope)')
    .action((opts: { root?: string; harness: Harness | 'all'; mode: HookMode; headsUp?: boolean; command?: string; mcp?: boolean }) => {
      const root = opts.root ? resolve(opts.root) : requireRoot(undefined);
      const script = process.argv[1] ? realpathSync(process.argv[1]) : '';
      const command =
        opts.command ??
        hookCommand({ execPath: process.execPath, script, version: VERSION, mode: opts.mode, headsUp: Boolean(opts.headsUp), ...(env.PATH ? { pathEnv: env.PATH } : {}) });
      const targets: Harness[] = opts.harness === 'all' ? [...HARNESSES] : [opts.harness];
      // Check every target first, so `--harness all` never leaves a partial install behind.
      for (const h of targets) {
        try {
          preflight(root, h);
        } catch (err) {
          throw new CliError(`${(err as Error).message} Nothing was installed.`);
        }
      }
      for (const h of targets) {
        const r = install(root, h, command);
        process.stdout.write(`${r.changed ? 'Installed' : 'Already installed'}: ${h} hook in ${relative(process.cwd(), r.file) || r.file}\n`);
        for (const n of r.notes) process.stdout.write(`  ${n}\n`);
      }
      process.stdout.write(`  Command: ${command}\n`);
      if (opts.mcp) {
        const r = installMcp(root, mcpCommand({ execPath: process.execPath, script, version: VERSION, ...(env.PATH ? { pathEnv: env.PATH } : {}) }));
        process.stdout.write(`${r.changed ? 'Installed' : 'Already installed'}: MCP server in ${relative(process.cwd(), r.file) || r.file}\n`);
        for (const n of r.notes) process.stdout.write(`  ${n}\n`);
      }
      if (!readIndex(root)) process.stdout.write('  No index yet. Run `landmine scan` so the hook has something to match.\n');
    });

  program
    .command('rules')
    .description('Print (or write into AGENTS.md / CLAUDE.md / GEMINI.md) a short known-open-bugs section any agent reads')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: nearest directory with a lockfile)')
    .option('-w, --write <files...>', `markdown files to update between landmine markers (e.g. ${RULES_TARGETS.join(' ')})`)
    .option('--max <n>', 'most issues to list', positiveInt, DEFAULT_MAX_RULES)
    .action((opts: { root?: string; write?: string[]; max: number }) => {
      const root = opts.root ? resolve(opts.root) : requireRoot(undefined);
      const section = renderRules(loadIndex(root), opts.max);
      if (!opts.write?.length) {
        process.stdout.write(`${section}\n`);
        return;
      }
      for (const f of opts.write) {
        const path = resolve(root, f);
        process.stdout.write(`${writeRules(path, section)}: ${relative(process.cwd(), path) || path}\n`);
      }
    });

  program
    .command('uninstall')
    .description("Remove landmine's hook entries (other hooks are left alone)")
    .option('-r, --root <dir>', 'project directory (default: nearest directory with a lockfile)')
    .option('--harness <name>', `${HARNESSES.join(', ')} or all`, harnessArg, 'all')
    .action((opts: { root?: string; harness: Harness | 'all' }) => {
      const root = opts.root ? resolve(opts.root) : requireRoot(undefined);
      const targets: Harness[] = opts.harness === 'all' ? [...HARNESSES] : [opts.harness];
      for (const h of targets) {
        const r = uninstall(root, h);
        if (r.changed) process.stdout.write(`Removed: ${h} hook from ${relative(process.cwd(), r.file) || r.file}\n`);
      }
    });

  program
    .command('mcp')
    .description('Run an MCP server (stdio) with landmine_check, landmine_search and landmine_list over the index')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: working directory)')
    .action(async (opts: { root?: string }) => {
      const { serveStdio } = await import('./mcp.js');
      await serveStdio({ ...(opts.root ? { root: resolve(opts.root) } : {}), cwd: process.cwd() });
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

function harnessArg(value: string): Harness | 'all' {
  if (value === 'all' || (HARNESSES as readonly string[]).includes(value)) return value as Harness | 'all';
  throw new InvalidArgumentError(`expected one of ${HARNESSES.join(', ')}, all`);
}

function modeArg(value: string): HookMode {
  if (value === 'block' || value === 'warn') return value;
  throw new InvalidArgumentError('expected block or warn');
}

/** Hook payloads are small; stop at 10 MB or after 5 s so a harness that leaves stdin open cannot hang us. */
function readStdin(maxBytes = 10_000_000, timeoutMs = 5000): Promise<string> {
  return new Promise((resolveText) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (): void => {
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.pause();
      resolveText(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.on('data', (chunk: Buffer | string) => {
      const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += b.length;
      if (size > maxBytes) return finish();
      chunks.push(b);
    });
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
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
