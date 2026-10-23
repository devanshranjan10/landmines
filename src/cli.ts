import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { GitHubClient } from './github/client.js';
import { findToken } from './github/token.js';
import { type Http, liveHttp, recordingHttp, replayHttp } from './http.js';
import { findProjectRoot } from './lockfiles/index.js';
import { lookupPackage, lookupSummary, parseSpec } from './lookup.js';
import { HARNESSES, type Harness } from './hook/payload.js';
import { FORMATS, FORMAT_FOR, type Format, type HookMode, canWarn } from './hook/respond.js';
import { runHook } from './hook/run.js';
import { MCP_TARGETS, type McpTarget, hookCommand, install, installMcp, launcher, mcpCommand, preflight, uninstall } from './install.js';
import { defaultRulesFiles, detectAgents } from './agents.js';
import { checkFile, fileContext, matchTouches } from './match.js';
import { type StagedFile, stagedFiles } from './staged.js';
import { projectUsage } from './usage.js';
import { langForPath } from './source/lang.js';
import { touches } from './source/touches.js';
import { PROVIDERS, type ProviderName, anthropicSdkAvailable, claudeCliAvailable, provider } from './llm.js';
import { humanLandmine } from './message.js';
import { shareText } from './share.js';
import { isArmed } from './policy.js';
import { renderScanSummary, wantsColor } from './render.js';
import { DEFAULT_MAX_RULES, RULES_TARGETS, SKILL_PATH, renderRules, renderSkill, stripRules, writeRules } from './rules.js';
import { scan } from './scan.js';
import { findIndexRoot, readIndex, writeIndex } from './store.js';
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

/** A path relative to the working directory, comparing real paths (Windows can mix 8.3 short and long names). */
function displayPath(path: string): string {
  const real = (p: string): string => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  };
  const rel = relative(real(process.cwd()), real(path));
  return rel && !rel.startsWith('..') ? rel.split('\\').join('/') : path;
}

/** Default cap on new model calls per `landmine cards` run, so a big monorepo never runs up a surprise bill. */
const CARDS_DEFAULT_MAX = 50;

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new InvalidArgumentError('expected an integer from 1 to 1000');
  return n;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
  }
}

/**
 * The project to write agent configuration into. Refuses a lockfile found in the home directory: there, the agent
 * config directories (.claude, .cursor, .codex …) are the user-level ones for every project.
 */
function requireProjectRoot(explicit: string | undefined): string {
  if (explicit) return resolve(explicit);
  const root = requireRoot(undefined);
  if (resolve(root) === resolve(homedir())) {
    throw new CliError(
      `The nearest lockfile is in your home directory (${root}), so this would edit your user-level agent settings. Run it inside a project, or pass --root ${root} if that is really what you want.`,
    );
  }
  return root;
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
        if (result.failed > 0) process.exitCode = 2;
        return;
      }
      const rel = result.indexFile ? relative(process.cwd(), result.indexFile) : undefined;
      const indexFile = rel && !rel.startsWith('..') ? rel : result.indexFile;
      process.stdout.write(
        `\n${renderScanSummary(result.index, { skipped: result.skipped, notes: result.notes, reused: result.reused, ...(indexFile ? { indexFile } : {}) }, { color: wantsColor(process.stdout, env) })}`,
      );
      // A partial scan is not a clean result: say so, and fail CI.
      if (result.failed > 0) {
        process.stderr.write(`landmine: ${result.failed} package${result.failed === 1 ? '' : 's'} could not be fetched (network, registry or GitHub rate limit). Re-run \`landmine scan\` later.\n`);
        process.exitCode = 2;
      }
    });

  program
    .command('check')
    .description('Report landmines that whole files touch (as if every line were being edited), or that staged changes add')
    .argument('[files...]', 'JS/TS or Python files')
    .option('--staged', 'check the lines staged for commit instead (a pre-commit check for agents without hooks)')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: nearest one above each file)')
    .option('--json', 'machine-readable output')
    .option('--exit-code', 'exit 1 when a match would block an edit (for CI and pre-commit); exit 2 on errors')
    .option('--strict', 'with --exit-code: also fail on heads-up matches (most of which do not apply)')
    .action((files: string[], opts: { root?: string; json?: boolean; exitCode?: boolean; strict?: boolean; staged?: boolean }) => {
      const color = { color: wantsColor(process.stdout, env) };
      const results: Array<{ file: string; hits: ReturnType<typeof checkFile> }> = [];
      if (opts.staged) {
        let staged: StagedFile[];
        try {
          staged = stagedFiles(process.cwd());
        } catch (err) {
          const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
          const detail = e.code === 'ENOENT' ? 'git is not installed or not on PATH' : String(e.stderr ?? e.message).trim().split('\n')[0];
          throw new CliError(`--staged: ${detail}`);
        }
        for (const f of staged) {
          const lang = langForPath(f.path);
          if (!lang) continue;
          const index = loadIndex(opts.root ?? dirname(f.path));
          const found = touches({ fileText: f.fileText, changedText: f.changedText, lang });
          results.push({ file: displayPath(f.path), hits: matchTouches(found, index, lang, fileContext(f.fileText, lang, f.changedText)) });
        }
      } else if (files.length === 0) {
        throw new CliError('Name the files to check, or pass --staged.');
      }
      for (const file of opts.staged ? [] : files) {
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
      if (opts.exitCode && results.some((r) => r.hits.some((h) => opts.strict || h.corroboratedBy))) process.exitCode = 1;
    });

  program
    .command('hook')
    .description('Hook entry point: reads the harness payload on stdin, blocks an edit once per known bug (exits 0, except exit code 2 in the exit2 format)')
    .option('--mode <mode>', 'block (deny once, then allow the retry) or warn (add context, never block)', modeArg, 'block')
    .option('--harness <name>', `force the payload format (${HARNESSES.join(', ')}); default: detect`, harnessArg)
    .option('--heads-up', 'in block mode, also pass weaker (uncorroborated) matches to the agent as non-blocking context')
    .option('--format <format>', `override the output format (${FORMATS.join(', ')}); exit2 works with most Claude-style hook systems`, formatArg)
    .action(async (opts: { mode: HookMode; harness?: Harness | 'all'; headsUp?: boolean; format?: Format }) => {
      if (process.stdin.isTTY) {
        process.stderr.write('landmine hook reads a coding agent\'s pre-tool hook payload on stdin. See `landmine install`.\n');
        return;
      }
      try {
        const input = await readStdin();
        const harness = opts.harness === 'all' ? undefined : opts.harness;
        const result = runHook(input, { mode: opts.mode, env, ...(harness ? { harness } : {}), ...(opts.format ? { format: opts.format } : {}), ...(opts.headsUp ? { headsUp: true } : {}) });
        if (result.stdout) process.stdout.write(`${result.stdout}\n`);
        if (result.stderr) process.stderr.write(`${result.stderr}\n`);
        if (result.exitCode) process.exitCode = result.exitCode;
        if (env.LANDMINE_DEBUG === '1') process.stderr.write(`landmine: ${result.decision}${result.reason ? ` (${result.reason})` : ''}\n`);
      } catch {
        // Never get in the agent's way.
      }
    });

  program
    .command('install')
    .description('Wire landmine into your coding agents (default: Claude Code plus every agent already configured in this project)')
    .option('-r, --root <dir>', 'project directory (default: nearest directory with a lockfile)')
    .option('--harness <names>', `comma-separated: ${HARNESSES.join(', ')}; or auto, all`, harnessList, 'auto')
    .option('--mode <mode>', 'block (interrupt once on a strong match) or warn (never block; pass every match as context)', modeArg, 'block')
    .option('--heads-up', 'block mode: also pass weaker matches to the agent as non-blocking context')
    .option('--command <cmd>', 'exact command the agents should run (default: this landmine install)')
    .option('--mcp [agents]', `also register the landmine MCP server (comma-separated: ${Object.keys(MCP_TARGETS).join(', ')}; default claude)`)
    .option('--rules [files]', 'also write the known-bugs section into agent instruction files (default: AGENTS.md, CLAUDE.md, GEMINI.md if Gemini CLI is in use, and any that exist)')
    .action((opts: { root?: string; harness: Harness[] | 'auto' | 'all'; mode: HookMode; headsUp?: boolean; command?: string; mcp?: boolean | string; rules?: boolean | string }) => {
      const root = requireProjectRoot(opts.root);
      const script = process.argv[1] ? realpathSync(process.argv[1]) : '';
      const launch = { execPath: process.execPath, script, version: VERSION, root, ...(env.PATH ? { pathEnv: env.PATH } : {}) };
      const command = opts.command ?? hookCommand({ ...launch, mode: opts.mode, headsUp: Boolean(opts.headsUp) });
      let targets: Harness[] = opts.harness === 'all' ? [...HARNESSES] : opts.harness === 'auto' ? detectAgents(root) : opts.harness;
      // Check every target first, so a multi-agent install never leaves a partial install behind. Agents found by
      // auto-detection whose config cannot be edited safely are skipped with a note; ones the user named are an error.
      const skippedTargets: string[] = [];
      for (const h of targets) {
        try {
          preflight(root, h);
        } catch (err) {
          if (opts.harness !== 'auto') throw new CliError(`${(err as Error).message} Nothing was installed.`);
          skippedTargets.push(`${h}: ${(err as Error).message}`);
        }
      }
      targets = targets.filter((h) => !skippedTargets.some((x) => x.startsWith(`${h}:`)));
      for (const n of skippedTargets) process.stdout.write(`Skipped ${n}\n`);
      for (const h of targets) {
        const r = install(root, h, command);
        process.stdout.write(`${r.changed ? 'Installed' : 'Already installed'}: ${h} hook in ${r.file.split(', ').map((f) => relative(process.cwd(), f) || f).join(', ')}\n`);
        for (const n of r.notes) process.stdout.write(`  ${n}\n`);
      }
      process.stdout.write(`  Command: ${command}\n`);
      if (!opts.command && launcher(launch).kind === 'path') {
        process.stdout.write('  Note: this command uses absolute paths that only work on this machine. For a team, add landmine as a dev dependency (`npm i -D landmines`) and run `npx landmines install` again.\n');
      }
      if (opts.mode === 'warn') {
        const silent = targets.filter((h) => !canWarn(FORMAT_FOR[h]));
        if (silent.length) process.stdout.write(`  Note: ${silent.join(', ')} cannot show a non-blocking warning, so in warn mode landmine stays silent there.\n`);
      }
      if (opts.mcp) {
        const server = mcpCommand(launch);
        const mcpTargets = opts.mcp === true ? ['claude'] : opts.mcp.split(',').map((x) => x.trim()).filter(Boolean);
        for (const t of mcpTargets) {
          if (!(t in MCP_TARGETS)) throw new CliError(`Unknown MCP target ${t}; expected one of ${Object.keys(MCP_TARGETS).join(', ')}`);
          const r = installMcp(root, server, t as McpTarget);
          process.stdout.write(`${r.changed ? 'Installed' : 'Already installed'}: ${t} MCP server in ${relative(process.cwd(), r.file) || r.file}\n`);
        }
      }
      const index = readIndex(root);
      if (opts.rules) {
        if (!index) throw new CliError('No .landmine/index.json yet: run `landmine scan` before `install --rules`.');
        const files = opts.rules === true ? defaultRulesFiles(root, targets) : opts.rules.split(',').map((x) => x.trim()).filter(Boolean);
        const section = renderRules(index, undefined, projectUsage(root, index));
        for (const f of files) process.stdout.write(`Rules ${writeRules(resolve(root, f), section)}: ${f}\n`);
      }
      if (!index) process.stdout.write('  No index yet. Run `landmine scan` so the hook has something to match.\n');
    });

  program
    .command('uninstall')
    .description("Remove landmine's hooks, plugins and rules sections (other hooks are left alone)")
    .option('-r, --root <dir>', 'project directory (default: nearest directory with a lockfile)')
    .option('--harness <names>', `comma-separated: ${HARNESSES.join(', ')}; or all`, harnessList, 'all')
    .action((opts: { root?: string; harness: Harness[] | 'auto' | 'all' }) => {
      const root = requireProjectRoot(opts.root);
      const targets: Harness[] = opts.harness === 'all' ? [...HARNESSES] : opts.harness === 'auto' ? detectAgents(root) : opts.harness;
      // Each agent on its own: one config landmine cannot read must not leave the others installed.
      for (const h of targets) {
        try {
          const r = uninstall(root, h);
          if (r.changed) process.stdout.write(`Removed: ${h} hook from ${r.file.split(', ').map((f) => relative(process.cwd(), f) || f).join(', ')}\n`);
        } catch (err) {
          process.stderr.write(`landmine: could not remove the ${h} hook: ${(err as Error).message}\n`);
          process.exitCode = 2;
        }
      }
      if (opts.harness === 'all') {
        for (const f of RULES_TARGETS) {
          const path = join(root, f);
          if (!existsSync(path)) continue;
          const before = readFileSync(path, 'utf8');
          const after = stripRules(before);
          if (after === before) continue;
          if (after === undefined) rmSync(path);
          else writeFileSync(path, after);
          process.stdout.write(`Removed: rules section from ${f}\n`);
        }
        const skill = join(root, SKILL_PATH);
        if (existsSync(skill) && readFileSync(skill, 'utf8').includes('landmine-managed')) {
          rmSync(dirname(skill), { recursive: true, force: true });
          // Leave no empty .agents/skills (or .agents) behind.
          for (const dir of [join(root, '.agents', 'skills'), join(root, '.agents')]) {
            try {
              if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
            } catch {
              // already gone
            }
          }
          process.stdout.write(`Removed: ${SKILL_PATH}\n`);
        }
      }
    });

  program
    .command('rules')
    .description('Print (or write into AGENTS.md / CLAUDE.md / GEMINI.md) a short known-open-bugs section any agent reads')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: nearest directory with a lockfile)')
    .option('-w, --write <files...>', `markdown files to update between landmine markers (e.g. ${RULES_TARGETS.join(' ')})`)
    .option('--skill', `also write the full list as an Agent Skill (${SKILL_PATH})`)
    .option('--rank <how>', 'usage: issues whose APIs your code uses first (default); confidence: card confidence only', 'usage')
    .option('--max <n>', 'most issues to list', positiveInt, DEFAULT_MAX_RULES)
    .action((opts: { root?: string; write?: string[]; max: number; skill?: boolean; rank: string }) => {
      if (opts.rank !== 'usage' && opts.rank !== 'confidence') throw new CliError('--rank must be usage or confidence');
      const root = requireProjectRoot(opts.root);
      const index = loadIndex(root);
      // Rank by what this project's code uses, so the short list goes to the issues it is closest to.
      const usage = opts.rank === 'usage' ? projectUsage(root, index) : undefined;
      const section = renderRules(index, opts.max, usage);
      if (opts.skill) {
        const path = join(root, SKILL_PATH);
        const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
        if (before !== undefined && !before.includes('landmine-managed')) throw new CliError(`${SKILL_PATH} exists and was not written by landmine; not overwriting it.`);
        const after = renderSkill(index, undefined, usage);
        mkdirSync(dirname(path), { recursive: true });
        if (before !== after) writeFileSync(path, after);
        process.stdout.write(`${before === undefined ? 'created' : before === after ? 'unchanged' : 'updated'}: ${SKILL_PATH}\n`);
      }
      if (!opts.write?.length) {
        if (opts.skill) return;
        process.stdout.write(`${section}\n`);
        return;
      }
      for (const f of opts.write) {
        const path = resolve(root, f);
        process.stdout.write(`${writeRules(path, section)}: ${relative(process.cwd(), path) || path}\n`);
      }
    });

  program
    .command('cards')
    .description('Have a model write a trigger card for each indexed issue (once, cached), so the hook matches the code that actually hits each bug')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: nearest directory with a lockfile)')
    .option('--provider <name>', `${PROVIDERS.join(' | ')} (default: anthropic with ANTHROPIC_API_KEY, openai with OPENAI_API_KEY, else claude-cli)`)
    .option('--model <id>', 'model id (default depends on the provider)')
    .option('--max <n>', `most new model calls this run (default ${CARDS_DEFAULT_MAX}; cached cards are free and always applied)`, positiveInt)
    .option('--all', 'no cap on model calls: card every issue now')
    .option('--concurrency <n>', 'parallel model calls', positiveInt, 4)
    .option('--from <dir>', 'apply precomputed cards (<owner_repo_N>@<version>.json) instead of calling a model')
    .option('--export <dir>', 'also copy every card into <dir> in the --from layout')
    .option('-q, --quiet', 'no progress output')
    .action(async (opts: { root?: string; provider?: string; model?: string; max?: number; all?: boolean; concurrency: number; from?: string; export?: string; quiet?: boolean }) => {
      const root = opts.root ? resolve(opts.root) : requireRoot(undefined);
      const index = loadIndex(root);
      const log = opts.quiet ? () => {} : (m: string) => process.stderr.write(`${m}\n`);
      const { addCards, cardPlan, exportCards, loadCards } = await import('./cards.js');
      if (opts.from) {
        const n = loadCards(index, resolve(opts.from));
        writeIndex(root, index);
        process.stdout.write(`Applied ${n} card${n === 1 ? '' : 's'} from ${opts.from}\n`);
      } else {
        let name = (opts.provider ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : 'claude-cli')) as ProviderName;
        if (!PROVIDERS.includes(name)) throw new CliError(`unknown provider ${name}; use one of ${PROVIDERS.join(', ')}`);
        // The Anthropic SDK is an optional peer: when it is not installed and no provider was asked for, fall back to a
        // Claude Code login rather than failing (npx and global installs cannot see the project's node_modules).
        if (name === 'anthropic' && !opts.provider && !(await anthropicSdkAvailable())) {
          log('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed; using the claude CLI instead (pass --provider anthropic after `npm i @anthropic-ai/sdk`).');
          name = 'claude-cli';
        }
        if (name === 'claude-cli' && !(await claudeCliAvailable())) {
          throw new CliError('`landmine cards` needs a model: install Claude Code (`claude` on PATH, logged in), set ANTHROPIC_API_KEY with @anthropic-ai/sdk installed, or set OPENAI_API_KEY (any OpenAI-compatible endpoint via OPENAI_BASE_URL).');
        }
        const llm = await provider(name, { env, ...(opts.model ? { model: opts.model } : {}) });
        const maxNew = opts.all ? undefined : (opts.max ?? CARDS_DEFAULT_MAX);
        const plan = cardPlan(root, index, llm);
        log(
          `Trigger cards with ${llm.name}:${llm.model}: ${plan.cached + plan.uncached} candidate issue${plan.cached + plan.uncached === 1 ? '' : 's'}, ${plan.cached} already cached, ` +
            `${maxNew === undefined || plan.uncached <= maxNew ? plan.uncached : maxNew} model call${plan.uncached === 1 ? '' : 's'} this run.`,
        );
        const run = await addCards(root, index, llm, { ...(maxNew !== undefined ? { maxNew } : {}), concurrency: opts.concurrency, log });
        writeIndex(root, index);
        const armed = index.landmines.filter((l) => l.card && isArmed(l)).length;
        process.stdout.write(
          `Cards: ${run.generated} written, ${run.cached} from cache, ${run.failed.length} failed, ${run.rejected.length} unusable · ${armed} issue${armed === 1 ? '' : 's'} armed by a card\n`,
        );
        if (run.skipped) process.stdout.write(`${run.skipped} more issue${run.skipped === 1 ? '' : 's'} left for the next run (cap of ${String(maxNew)} model calls; use --max or --all).\n`);
        if (run.failed.length) process.exitCode = 2;
      }
      if (opts.export) process.stdout.write(`Exported ${exportCards(index, resolve(opts.export))} cards to ${opts.export}\n`);
    });

  program
    .command('lookup')
    .description('Open GitHub issues filed against exact package versions, without a lockfile or scan (next@16.4.0, pandas==2.3.1)')
    .argument('<packages...>', 'exact versions: name@version (npm), name==version (PyPI), or a bare name for the latest')
    .option('--pypi', 'treat name@version specs as PyPI packages')
    .option('-m, --max-issues <n>', 'most issues to fetch per package version', positiveInt, 100)
    .option('--json', 'print the results as JSON')
    .action(async (specs: string[], opts: { pypi?: boolean; maxIssues: number; json?: boolean }) => {
      const { http, replay } = httpFromEnv(env);
      const token = replay ? { token: 'offline', source: 'GITHUB_TOKEN' as const } : await findToken(env);
      if (!token) throw new CliError('landmine lookup needs a GitHub token. Set GITHUB_TOKEN or GH_TOKEN, or log in with `gh auth login`. A token with no scopes is enough.');
      const targets = specs.map((s) => parseSpec(s, opts.pypi ? 'pypi' : 'npm'));
      const bad = targets.find((t) => 'error' in t);
      if (bad && 'error' in bad) throw new CliError(bad.error);
      const github = new GitHubClient({ http, token: token.token });
      const results = [];
      for (const t of targets) if (!('error' in t)) results.push(await lookupPackage(t, { http, github, maxIssues: opts.maxIssues }));
      if (opts.json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
      else {
        const color = { color: wantsColor(process.stdout, env) };
        for (const r of results) {
          process.stdout.write(`${lookupSummary(r)}\n`);
          for (const l of r.landmines) process.stdout.write(`${humanLandmine(l, color)}\n`);
          if (results.length > 1) process.stdout.write('\n');
        }
      }
      if (results.some((r) => r.status === 'error')) process.exitCode = 2;
    });

  program
    .command('mcp')
    .description('Run an MCP server (stdio): landmine_check, landmine_search and landmine_list over the index, and landmine_lookup for any version')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: working directory)')
    .action(async (opts: { root?: string }) => {
      const { serveStdio } = await import('./mcp.js');
      await serveStdio({ ...(opts.root ? { root: resolve(opts.root) } : {}), cwd: process.cwd() });
    });

  program
    .command('share')
    .description('Print a one-line summary of this project\'s scan and a README badge, to post or paste')
    .option('-r, --root <dir>', 'project with .landmine/index.json (default: nearest directory with a lockfile)')
    .action((opts: { root?: string }) => {
      const root = opts.root ? resolve(opts.root) : requireRoot(undefined);
      process.stdout.write(`${shareText(loadIndex(root))}\n`);
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

function harnessList(value: string): Harness[] | 'auto' | 'all' {
  if (value === 'auto' || value === 'all') return value;
  const names = value.split(',').map((v) => v.trim()).filter(Boolean);
  for (const n of names) if (!(HARNESSES as readonly string[]).includes(n)) throw new InvalidArgumentError(`unknown agent ${n}; expected ${HARNESSES.join(', ')}, auto or all`);
  return names as Harness[];
}

function harnessArg(value: string): Harness | 'all' {
  if (value === 'all' || (HARNESSES as readonly string[]).includes(value)) return value as Harness | 'all';
  throw new InvalidArgumentError(`expected one of ${HARNESSES.join(', ')}, all`);
}

function formatArg(value: string): Format {
  if ((FORMATS as readonly string[]).includes(value)) return value as Format;
  throw new InvalidArgumentError(`expected one of ${FORMATS.join(', ')}`);
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
    return err instanceof CliError ? err.exitCode : 2;
  }
}

process.exitCode = await main(process.argv);
