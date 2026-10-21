import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { GitHubClient } from '../src/github/client.js';
import { parseApplyPatch } from '../src/hook/patch.js';
import { addedLines, detectHarness, extractEdits } from '../src/hook/payload.js';
import { respond } from '../src/hook/respond.js';
import { runHook } from '../src/hook/run.js';
import { replayHttp } from '../src/http.js';
import { hookCommand, install, preferredNode, uninstall } from '../src/install.js';
import { scan } from '../src/scan.js';

const run = promisify(execFile);
const HTTP_DIR = new URL('./fixtures/http/scan-demo/', import.meta.url).pathname;
const FIXTURE_PROJECT = new URL('./fixtures/projects/scan-demo/', import.meta.url).pathname;
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;
const DB_TS = "import { drizzle } from 'drizzle-orm/node-postgres';\nexport const db = drizzle({ connection: process.env.DATABASE_URL! });\n";
const TEARDOWN = 'afterAll(async () => {\n  await db.$client.end();\n});\n';

let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'lm-hook-'));
  for (const f of ['package.json', 'package-lock.json', 'requirements.txt']) cpSync(join(FIXTURE_PROJECT, f), join(root, f));
  const http = replayHttp(HTTP_DIR);
  await scan({ root, http, github: new GitHubClient({ http, token: 't' }), maxIssues: 30, now: () => new Date('2026-10-21T12:00:00Z') });
  writeFileSync(join(root, 'db.ts'), DB_TS);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'client.py'), 'import requests\n');
});

const claudeEdit = (session: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    session_id: session,
    transcript_path: '/tmp/t.jsonl',
    cwd: root,
    permission_mode: 'bypassPermissions',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(root, 'db.ts'), old_string: 'export const db', new_string: `${TEARDOWN}export const db`, replace_all: false },
    tool_use_id: 'toolu_1',
    ...extra,
  });

const state = (): string => mkdtempSync(join(tmpdir(), 'lm-state-'));

describe('harness detection and edit extraction', () => {
  it('detects each harness from its payload shape', () => {
    expect(detectHarness({ tool_name: 'Edit', session_id: 's' })).toBe('claude');
    expect(detectHarness({ tool_name: 'apply_patch', turn_id: 't' })).toBe('codex');
    expect(detectHarness({ tool_name: 'Write', cursor_version: '1.7', conversation_id: 'c' })).toBe('cursor');
    expect(detectHarness({ hook_event_name: 'BeforeTool', tool_name: 'replace' })).toBe('gemini');
  });

  it('Claude Edit: the file context has the replacement applied; only new_string is "changed"', () => {
    const [e] = extractEdits(JSON.parse(claudeEdit('x')) as Record<string, unknown>, 'claude', root);
    expect(e?.changedText).toBe(`${TEARDOWN}export const db`);
    expect(e?.fileText).toContain("import { drizzle } from 'drizzle-orm/node-postgres'");
    expect(e?.fileText).toContain('await db.$client.end()');
  });

  it('Write and Cursor full-file writes: only lines that are new count', () => {
    expect(addedLines('a\nb\nc', 'a\nb\nX\nc')).toBe('X');
    expect(addedLines(undefined, 'new file')).toBe('new file');
    const [e] = extractEdits({ tool_name: 'Write', cursor_version: '1', tool_input: { file_path: 'db.ts', content: `${DB_TS}${TEARDOWN}` } }, 'cursor', root);
    expect(e?.path).toBe(join(root, 'db.ts'));
    expect(e?.changedText).toBe(TEARDOWN.trimEnd());
  });

  it('MultiEdit applies edits in order', () => {
    const [e] = extractEdits(
      { tool_name: 'MultiEdit', tool_input: { file_path: join(root, 'db.ts'), edits: [{ old_string: 'export const db', new_string: 'export const database' }, { old_string: 'database', new_string: 'db2' }] } },
      'claude',
      root,
    );
    expect(e?.fileText).toContain('export const db2 =');
    expect(e?.changedText).toBe('export const database\ndb2');
  });

  it('Codex apply_patch: added lines per file, relative paths, moves, deletes skipped', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: db.ts',
      '@@',
      ' export const db = drizzle({ connection: process.env.DATABASE_URL! });',
      '+afterAll(async () => { await db.$client.end(); });',
      '*** Add File: src/new.ts',
      "+import { z } from 'zod';",
      '*** Delete File: old.ts',
      '*** Update File: a.ts',
      '*** Move to: b.ts',
      '-x',
      '+y',
      '*** End Patch',
    ].join('\n');
    expect(parseApplyPatch(patch).map((f) => [f.kind, f.path, f.movedTo, f.added.length])).toEqual([
      ['update', 'db.ts', undefined, 1],
      ['add', 'src/new.ts', undefined, 1],
      ['delete', 'old.ts', undefined, 0],
      ['update', 'a.ts', 'b.ts', 1],
    ]);
    const edits = extractEdits({ tool_name: 'apply_patch', tool_input: { command: patch } }, 'codex', root);
    expect(edits.map((e) => e.path)).toEqual([join(root, 'db.ts'), join(root, 'src/new.ts'), join(root, 'b.ts')]);
    expect(edits[0]?.fileText).toContain("from 'drizzle-orm/node-postgres'");
  });

  it('Gemini replace and NotebookEdit', () => {
    expect(extractEdits({ tool_name: 'replace', tool_input: { file_path: join(root, 'db.ts'), old_string: 'a', new_string: 'b', instruction: 'x' } }, 'gemini', root)[0]?.changedText).toBe('b');
    expect(extractEdits({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'n.ipynb', new_source: 'x' } }, 'claude', root)).toEqual([]);
  });
});

describe('runHook', () => {
  it('blocks once with the issue in the deny reason, then lets the retry through', () => {
    const dir = state();
    const first = runHook(claudeEdit('session-a'), { stateDir: dir });
    expect(first.decision).toBe('deny');
    const out = JSON.parse(first.stdout) as { hookSpecificOutput: Record<string, string> };
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('drizzle-team/drizzle-orm#3402');
    expect(runHook(claudeEdit('session-a'), { stateDir: dir })).toMatchObject({ stdout: '', decision: 'none', reason: 'already shown this session' });
    // a new session is warned again
    expect(runHook(claudeEdit('session-b'), { stateDir: dir }).decision).toBe('deny');
  });

  it('warn mode adds context instead of blocking', () => {
    const r = runHook(claudeEdit('w'), { stateDir: state(), mode: 'warn' });
    const out = JSON.parse(r.stdout) as { hookSpecificOutput: Record<string, string> };
    expect(out.hookSpecificOutput.additionalContext).toContain('This is a heads-up, not a block.');
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it('never prints anything when there is nothing to say, and never says "allow"', () => {
    const quiet = [
      '{not json',
      '[]',
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(root, 'db.ts'), new_string: TEARDOWN } }),
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: root, tool_input: { file_path: join(root, 'README.md'), old_string: '', new_string: 'db.$client.end()' } }),
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: root, tool_input: { file_path: join(root, 'db.ts'), old_string: 'x', new_string: 'console.log(1)' } }),
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: root, tool_input: { command: 'rm -rf /' } }),
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: tmpdir(), tool_input: { file_path: join(tmpdir(), 'x.ts'), new_string: TEARDOWN } }),
    ];
    for (const input of quiet) {
      const r = runHook(input, { stateDir: state() });
      expect(r.stdout).toBe('');
      expect(r.stdout).not.toContain('allow');
    }
  });

  it('cursor gets both the native and the Claude-compatible deny shape; gemini gets decision/reason', () => {
    const cursor = runHook(
      JSON.stringify({ conversation_id: 'c1', cursor_version: '1.7.0', hook_event_name: 'preToolUse', tool_name: 'Write', workspace_roots: [root], tool_input: { file_path: join(root, 'db.ts'), content: `${DB_TS}${TEARDOWN}` } }),
      { stateDir: state() },
    );
    expect(JSON.parse(cursor.stdout)).toMatchObject({ permission: 'deny', hookSpecificOutput: { permissionDecision: 'deny' } });
    const gemini = runHook(
      JSON.stringify({ session_id: 'g', hook_event_name: 'BeforeTool', tool_name: 'replace', cwd: root, tool_input: { file_path: join(root, 'db.ts'), old_string: 'export const db', new_string: `${TEARDOWN}export const db` } }),
      { stateDir: state() },
    );
    expect(JSON.parse(gemini.stdout)).toMatchObject({ decision: 'deny' });
    expect(respond('deny', 'warn', 'x')).toBeUndefined();
    expect(respond('cursor', 'warn', 'x')).toBeUndefined();
  });

  it('python edits are matched through import names; a bare symbol match is a heads-up, not a block', () => {
    const edit = (newString: string): string =>
      JSON.stringify({ session_id: 'py', hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: root, tool_input: { file_path: join(root, 'src', 'client.py'), old_string: 'import requests\n', new_string: newString } });
    // default: an uncorroborated match is dropped silently and does not use up the issue's one showing
    const dir = state();
    expect(runHook(edit('import requests\n\nrequests.put(url, data=payload)\n'), { stateDir: dir })).toMatchObject({
      stdout: '',
      decision: 'none',
      reason: 'only uncorroborated matches (heads-up off)',
    });
    const bare = runHook(edit('import requests\n\nrequests.put(url, data=payload)\n'), { stateDir: dir, headsUp: true });
    expect(bare.decision).toBe('context');
    expect(bare.hits[0]?.id).toMatch(/^psf\/requests#/);
    const ctx = JSON.parse(bare.stdout) as { hookSpecificOutput: Record<string, string> };
    expect(ctx.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(ctx.hookSpecificOutput.additionalContext).toMatch(/^landmine \(heads-up, not blocking\)/);
    // importing urllib3 (another package the issue names) is not using requests' API in the buggy way: still a heads-up
    expect(runHook(edit('import requests\nimport urllib3\n\nrequests.put(url, data=payload)\n'), { stateDir: state(), headsUp: true }).decision).toBe('context');
  });

  it('a heads-up stays silent on harnesses with no non-blocking context channel', () => {
    const r = runHook(
      JSON.stringify({ session_id: 'g2', hook_event_name: 'BeforeTool', tool_name: 'replace', cwd: root, tool_input: { file_path: join(root, 'src', 'client.py'), old_string: 'import requests\n', new_string: 'import requests\n\nrequests.put(url, data=payload)\n' } }),
      { stateDir: state(), headsUp: true },
    );
    expect(r).toMatchObject({ stdout: '', decision: 'none' });
  });

  it('the built CLI hook exits 0 and prints the JSON', async () => {
    const child = execFile(process.execPath, [CLI, 'hook'], { env: { ...process.env, LANDMINE_STATE_DIR: state() } });
    child.stdin?.end(claudeEdit('cli'));
    const stdout = await new Promise<string>((resolve, reject) => {
      let s = '';
      child.stdout?.on('data', (d: Buffer) => (s += d.toString()));
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve(s) : reject(new Error(`exit ${code}`))));
    });
    expect(JSON.parse(stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });
});

describe('install / uninstall', () => {
  it('merges into existing settings, is idempotent, and keeps other hooks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-install-'));
    mkdirSync(join(dir, '.claude'));
    const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard.sh' }] };
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [foreign] } }));
    expect(install(dir, 'claude', 'node /x/landmine/dist/cli.js hook').changed).toBe(true);
    expect(install(dir, 'claude', 'node /x/landmine/dist/cli.js hook').changed).toBe(false);
    install(dir, 'claude', 'node /y/cli.js hook'); // replaces (recognised as ours), does not duplicate
    install(dir, 'claude', 'node /y/cli.js hook'); // custom command without "landmine" in it: still idempotent
    const cfg = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as { permissions: unknown; hooks: { PreToolUse: unknown[] } };
    expect(cfg.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(cfg.hooks.PreToolUse).toEqual([foreign, { matcher: 'Edit|Write|MultiEdit|edit|write|apply_patch', hooks: [{ type: 'command', command: 'node /y/cli.js hook', timeout: 10, statusMessage: 'landmine: checking for known open bugs' }] }]);
    uninstall(dir, 'claude');
    expect((JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as { hooks: { PreToolUse: unknown[] } }).hooks.PreToolUse).toEqual([foreign]);
  });

  it('writes each harness format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-install-'));
    install(dir, 'codex', 'landmine hook');
    install(dir, 'cursor', 'landmine hook');
    install(dir, 'gemini', 'landmine hook');
    expect(JSON.parse(readFileSync(join(dir, '.codex', 'hooks.json'), 'utf8'))).toEqual({
      hooks: { PreToolUse: [{ matcher: '^apply_patch$', hooks: [{ type: 'command', command: 'landmine hook --harness codex', timeout: 10 }] }] },
    });
    expect(JSON.parse(readFileSync(join(dir, '.cursor', 'hooks.json'), 'utf8'))).toEqual({
      version: 1,
      hooks: { preToolUse: [{ command: 'landmine hook --harness cursor', matcher: 'Write', timeout: 10 }] },
    });
    expect(JSON.parse(readFileSync(join(dir, '.gemini', 'settings.json'), 'utf8'))).toEqual({
      hooks: { BeforeTool: [{ matcher: 'write_file|replace', hooks: [{ name: 'landmine', type: 'command', command: 'landmine hook --harness gemini', timeout: 10000 }] }] },
    });
  });

  it('refuses to overwrite a settings file that is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-install-'));
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), '{ "hooks": ');
    expect(() => install(dir, 'claude', 'landmine hook')).toThrow();
    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')).toBe('{ "hooks": ');
  });

  it('hook command: npx cache → pinned npx call; otherwise node + absolute script', () => {
    expect(hookCommand({ execPath: '/usr/bin/node', script: '/home/u/.npm/_npx/abc/node_modules/landmines/dist/cli.js', version: '0.1.0', mode: 'block' })).toBe(
      'npx -y landmines@0.1.0 hook',
    );
    expect(hookCommand({ execPath: '/nonexistent/node', script: '/opt/landmine/dist/cli.js', version: '0.1.0', mode: 'warn', pathEnv: '' })).toBe(
      '"/nonexistent/node" "/opt/landmine/dist/cli.js" hook --mode warn',
    );
    expect(preferredNode(process.execPath, process.env.PATH)).toMatch(/^(node|".+")$/);
  });

  it('cli install prints notes and the command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-install-'));
    writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}');
    const { stdout } = await run(process.execPath, [CLI, 'install', '--root', dir, '--harness', 'codex']);
    expect(stdout).toContain('Installed: codex hook');
    expect(stdout).toContain('/hooks');
    expect(stdout).toContain('No index yet');
  });
});

describe('captured Claude Code payloads (live session in examples/demo, docs/e2e)', () => {
  const load = (name: string, projectRoot: string): string =>
    readFileSync(new URL(`./fixtures/payloads/${name}`, import.meta.url), 'utf8').split('${ROOT}').join(projectRoot).split('${HOME}').join(tmpdir());

  it('denies the real first edit (db.$client.end) and stays silent on the real retry', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    cpSync(new URL('../examples/demo/src/db.ts', import.meta.url), join(root, 'src', 'db.ts'));
    const dir = state();
    const denied = runHook(load('claude-edit-denied.json', root), { stateDir: dir });
    expect(denied).toMatchObject({ decision: 'deny', harness: 'claude', hits: [{ id: 'drizzle-team/drizzle-orm#3402', symbol: '$client.end' }] });
    const retry = runHook(load('claude-edit-allowed.json', root), { stateDir: dir });
    expect(retry).toMatchObject({ decision: 'none', reason: 'no landmine touched', stdout: '' });
  });
});

describe('captured Codex CLI payloads (live codex exec session, docs/e2e)', () => {
  const load = (name: string, projectRoot: string): string =>
    readFileSync(new URL(`./fixtures/payloads/${name}`, import.meta.url), 'utf8').split('${ROOT}').join(projectRoot).split('${HOME}').join(tmpdir());

  it('denies the real apply_patch that adds db.$client.end() and allows the owned-pool retry', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    cpSync(new URL('../examples/demo/src/db.ts', import.meta.url), join(root, 'src', 'db.ts'));
    const dir = state();
    const denied = runHook(load('codex-apply-patch-denied.json', root), { stateDir: dir });
    expect(denied).toMatchObject({ decision: 'deny', harness: 'codex', hits: [{ id: 'drizzle-team/drizzle-orm#3402' }] });
    expect(JSON.parse(denied.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
    expect(runHook(load('codex-apply-patch-allowed.json', root), { stateDir: dir })).toMatchObject({ decision: 'none', stdout: '' });
  });
});

describe('install --mcp', () => {
  it('merges a landmine server into .mcp.json and keeps other servers', async () => {
    const { installMcp, mcpCommand } = await import('../src/install.js');
    const dir = mkdtempSync(join(tmpdir(), 'lm-mcpjson-'));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x' } } }));
    const cmd = mcpCommand({ execPath: '/nonexistent/node', script: '/opt/landmine/dist/cli.js', version: '0.1.0', pathEnv: '' });
    expect(cmd).toEqual({ command: '/nonexistent/node', args: ['/opt/landmine/dist/cli.js', 'mcp'] });
    expect(installMcp(dir, cmd).changed).toBe(true);
    expect(installMcp(dir, cmd).changed).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'))).toEqual({
      mcpServers: { other: { type: 'stdio', command: 'x' }, landmine: { type: 'stdio', command: '/nonexistent/node', args: ['/opt/landmine/dist/cli.js', 'mcp'] } },
    });
    expect(mcpCommand({ execPath: 'n', script: '/u/.npm/_npx/1/node_modules/landmines/dist/cli.js', version: '0.1.0' })).toEqual({ command: 'npx', args: ['-y', 'landmines@0.1.0', 'mcp'] });
  });
});

describe('code-review regressions', () => {
  const mkIndex = (dir: string, n: number): void => {
    const landmines = Array.from({ length: n }, (_, i) => ({
      id: `o/foo#${i + 1}`,
      ecosystem: 'npm' as const,
      package: 'foo',
      version: '1.0.0',
      issue: { number: i + 1, title: `methodA${i} breaks with optionB${i}`, url: `u${i}`, createdAt: '2026-01-01', updatedAt: '2026-01-01', author: 'a', labels: [], reactions: 0, comments: 0 },
      evidence: { strength: 'strong' as const, where: 'body' as const, kind: 'adjacent' as const, quote: 'foo@1.0.0' },
      symbols: [
        { name: `methodA${i}`, score: 1, sources: ['title' as const] },
        { name: `optionB${i}`, score: 1, sources: ['title' as const] },
      ],
    }));
    mkdirSync(join(dir, '.landmine'), { recursive: true });
    writeFileSync(
      join(dir, '.landmine', 'index.json'),
      JSON.stringify({
        schema: 1,
        generator: 't',
        generatedAt: '2026-01-01',
        lockfiles: [],
        packages: [{ ecosystem: 'npm', name: 'foo', version: '1.0.0', dev: false, status: 'ok', searchHits: n, verified: n, landmines: n, dropped: { unverified: 0, unaffected: 0, incidental: 0 } }],
        landmines,
      }),
    );
  };
  const editPayload = (dir: string, code: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: dir, tool_input: { file_path: join(dir, 'a.ts'), content: code }, ...extra });

  it('issues beyond the first three are still shown on a later edit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-five-'));
    mkIndex(dir, 5);
    const code = `import foo from 'foo';\n${[0, 1, 2, 3, 4].map((i) => `foo.methodA${i}({ optionB${i}: 1 });`).join('\n')}\n`;
    const st = state();
    const first = runHook(editPayload(dir, code), { stateDir: st });
    expect(first.decision).toBe('deny');
    expect(first.hits).toHaveLength(3);
    const second = runHook(editPayload(dir, code), { stateDir: st });
    expect(second.decision).toBe('deny');
    expect(second.hits).toHaveLength(2);
    expect(runHook(editPayload(dir, code), { stateDir: st }).decision).toBe('none');
  });

  it('a silent heads-up on Gemini does not use up the issue; the later corroborated edit still blocks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-gem-'));
    mkIndex(dir, 1);
    const st = state();
    const g = (code: string): string =>
      JSON.stringify({ session_id: 'g', hook_event_name: 'BeforeTool', tool_name: 'write_file', cwd: dir, tool_input: { file_path: join(dir, 'a.ts'), content: code } });
    expect(runHook(g("import foo from 'foo';\nfoo.methodA0();\n"), { stateDir: st, headsUp: true }).stdout).toBe('');
    const later = runHook(g("import foo from 'foo';\nfoo.methodA0({ optionB0: true });\n"), { stateDir: st, headsUp: true });
    expect(JSON.parse(later.stdout)).toMatchObject({ decision: 'deny' });
  });

  it('never reads FIFOs, devices or non-source files', async () => {
    const { readFileOrUndefined } = await import('../src/hook/payload.js');
    const dir = mkdtempSync(join(tmpdir(), 'lm-fifo-'));
    execFileSync('mkfifo', [join(dir, 'pipe.ts')]);
    expect(readFileOrUndefined(join(dir, 'pipe.ts'))).toBeUndefined();
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(readFileOrUndefined(join(dir, 'notes.txt'))).toBeUndefined();
    expect(readFileOrUndefined('/dev/zero')).toBeUndefined();
  });

  it('install never removes look-alike foreign hooks; uninstall removes custom commands via the registry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-own-'));
    mkdirSync(join(dir, '.claude'));
    const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: '/home/u/landmine-api/scripts/pre-commit-hook.sh' }] };
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [foreign] } }));
    install(dir, 'claude', 'node "/opt/x/landmine/dist/cli.js" hook');
    uninstall(dir, 'claude');
    expect(JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'))).toEqual({ hooks: { PreToolUse: [foreign] } });
    install(dir, 'cursor', '/opt/bin/lm-run check-edits');
    install(dir, 'cursor', '/opt/bin/lm-run check-edits');
    expect((JSON.parse(readFileSync(join(dir, '.cursor', 'hooks.json'), 'utf8')) as { hooks: { preToolUse: unknown[] } }).hooks.preToolUse).toHaveLength(1);
    uninstall(dir, 'cursor');
    expect(JSON.parse(readFileSync(join(dir, '.cursor', 'hooks.json'), 'utf8'))).toEqual({ version: 1, hooks: {} });
  });

  it('settings with comments are refused, and --harness all writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-jsonc-'));
    writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}');
    mkdirSync(join(dir, '.gemini'));
    writeFileSync(join(dir, '.gemini', 'settings.json'), '{\n  // my theme\n  "theme": "dark"\n}\n');
    await expect(run(process.execPath, [CLI, 'install', '--root', dir, '--harness', 'all'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('contains comments') as unknown,
    });
    expect(() => readFileSync(join(dir, '.claude', 'settings.json'))).toThrow();
    expect(readFileSync(join(dir, '.gemini', 'settings.json'), 'utf8')).toContain('// my theme');
  });

  it('state lives in a per-user directory', async () => {
    const { defaultStateDir } = await import('../src/hook/state.js');
    expect(defaultStateDir()).toMatch(/landmine-[\w.-]+$/);
  });
});
