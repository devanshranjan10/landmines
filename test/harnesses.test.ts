// Every supported agent: its documented (or source-derived) pre-edit payload → the right edit, the right deny format,
// and an install that writes the agent's own config. Shapes are from docs/research/harnesses.md.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectAgents } from '../src/agents.js';
import { GitHubClient } from '../src/github/client.js';
import { type Harness, HARNESSES, detectHarness, extractEdits } from '../src/hook/payload.js';
import { FORMAT_FOR } from '../src/hook/respond.js';
import { runHook } from '../src/hook/run.js';
import { replayHttp } from '../src/http.js';
import { MCP_TARGETS, type McpTarget, install, installMcp, uninstall } from '../src/install.js';
import { scan } from '../src/scan.js';

const HTTP_DIR = new URL('./fixtures/http/scan-demo/', import.meta.url).pathname;
const FIXTURE_PROJECT = new URL('./fixtures/projects/scan-demo/', import.meta.url).pathname;
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;
const DB_TS = "import { drizzle } from 'drizzle-orm/node-postgres';\nexport const db = drizzle({ connection: process.env.DATABASE_URL! });\n";
const TEARDOWN = 'afterAll(async () => {\n  await db.$client.end();\n});\n';
const OLD = 'export const db';
const NEW = `${TEARDOWN}export const db`;

let root: string;
let file: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'lm-harness-'));
  for (const f of ['package.json', 'package-lock.json', 'requirements.txt']) cpSync(join(FIXTURE_PROJECT, f), join(root, f));
  const http = replayHttp(HTTP_DIR);
  await scan({ root, http, github: new GitHubClient({ http, token: 't' }), maxIssues: 30, now: () => new Date('2026-10-21T12:00:00Z') });
  file = join(root, 'db.ts');
  writeFileSync(file, DB_TS);
});

/** One documented pre-edit payload per agent, each making the same edit (adds `db.$client.end()`). */
const PAYLOADS: Record<Exclude<Harness, 'claude' | 'codex' | 'cursor' | 'gemini'>, () => Record<string, unknown>> = {
  copilot: () => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: root, tool_name: 'replace_string_in_file', tool_input: { filePath: file, oldString: OLD, newString: NEW }, tool_use_id: 't' }),
  windsurf: () => ({ agent_action_name: 'pre_write_code', trajectory_id: 's', execution_id: 'e', timestamp: '', model_name: 'm', tool_info: { file_path: file, edits: [{ old_string: OLD, new_string: NEW }] } }),
  droid: () => ({ session_id: 's', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file, old_string: OLD, new_string: NEW } }),
  auggie: () => ({ hook_event_name: 'PreToolUse', conversation_id: 's', workspace_roots: [root], tool_name: 'str-replace-editor', tool_input: { command: 'str_replace', path: file, old_str_1: OLD, new_str_1: NEW }, is_mcp_tool: false }),
  kiro: () => ({ hook_event_name: 'PreToolUse', cwd: root, session_id: 's', tool_name: 'str_replace', tool_input: { path: file, old_str: OLD, new_str: NEW } }),
  qwen: () => ({ session_id: 's', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'edit', tool_input: { file_path: file, old_string: OLD, new_string: NEW, replace_all: false }, tool_use_id: 't' }),
  crush: () => ({ event: 'PreToolUse', session_id: 's', cwd: root, tool_name: 'edit', tool_input: { file_path: file, old_string: OLD, new_string: NEW } }),
  goose: () => ({ event: 'PreToolUse', session_id: 's', working_dir: root, tool_name: 'edit', tool_input: { path: file, before: OLD, after: NEW }, tool_call_id: 't' }),
  openhands: () => ({ event_type: 'PreToolUse', session_id: 's', working_dir: root, tool_name: 'file_editor', tool_input: { command: 'str_replace', path: file, old_str: OLD, new_str: NEW } }),
  trae: () => ({ session_id: 's', cwd: root, hook_event_name: 'PreToolUse', workspace_roots: [root], tool_use_id: 't', tool_name: 'Edit', llm_tool_name: 'edit', tool_input: { file_path: file, old_string: OLD, new_string: NEW } }),
  antigravity: () => ({ conversationId: 's', workspacePaths: [root], stepIdx: 3, toolCall: { name: 'replace_file_content', args: { TargetFile: file, TargetContent: OLD, ReplacementContent: NEW, AllowMultiple: false } } }),
  cline: () => ({ clineVersion: '3.0.3', hookName: 'PreToolUse', taskId: 's', workspaceRoots: [root], preToolUse: { toolName: 'replace_in_file', parameters: { path: file, old_text: OLD, new_text: NEW } } }),
  opencode: () => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: root, tool_name: 'edit', tool_input: { filePath: file, oldString: OLD, newString: NEW } }),
  kilo: () => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: root, tool_name: 'edit', tool_input: { filePath: file, oldString: OLD, newString: NEW } }),
  amp: () => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: root, tool_name: 'edit_file', tool_input: { path: file, old_str: OLD, new_str: NEW } }),
  pi: () => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: root, tool_name: 'edit', tool_input: { path: file, edits: [{ oldText: OLD, newText: NEW }] } }),
};

describe('every agent: payload → edit → deny in its own format', () => {
  for (const [harness, payload] of Object.entries(PAYLOADS) as Array<[Harness, () => Record<string, unknown>]>) {
    it(harness, () => {
      const p = payload();
      const [edit, ...rest] = extractEdits(p, harness, root);
      expect(rest).toHaveLength(0);
      expect(edit?.path).toBe(file);
      expect(edit?.changedText).toContain('db.$client.end()');
      expect(edit?.fileText).toContain("from 'drizzle-orm/node-postgres'");
      const r = runHook(JSON.stringify(p), { harness, stateDir: mkdtempSync(join(tmpdir(), 'lm-state-')), env: {} });
      const format = FORMAT_FOR[harness];
      expect(r.hits.map((h) => h.id)).toContain('drizzle-team/drizzle-orm#3402');
      switch (format) {
        case 'claude':
          expect(JSON.parse(r.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
          expect(r.decision).toBe('deny');
          break;
        case 'deny':
          expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'deny' });
          break;
        case 'block':
          expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'block' });
          break;
        case 'exit2':
          expect(r.stdout).toBe('');
          expect(r.exitCode).toBe(2);
          expect(r.stderr).toContain('drizzle-orm#3402');
          break;
        case 'cline':
          expect(JSON.parse(r.stdout)).toMatchObject({ cancel: false });
          expect((JSON.parse(r.stdout) as { context: string }).context).toContain('drizzle-orm#3402');
          expect(r.decision).toBe('context');
          break;
        case 'plugin':
          expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'deny' });
          break;
        default:
          throw new Error(`untested format ${format}`);
      }
    });
  }

  it('detection picks the right agent from payload shape alone where shapes are distinctive', () => {
    expect(detectHarness(PAYLOADS.windsurf())).toBe('windsurf');
    expect(detectHarness(PAYLOADS.antigravity())).toBe('antigravity');
    expect(detectHarness(PAYLOADS.cline())).toBe('cline');
    expect(detectHarness(PAYLOADS.openhands())).toBe('openhands');
    // Claude-shaped payloads (Copilot, Droid, Qwen…) fall back to the Claude format, which they all accept.
    expect(FORMAT_FOR[detectHarness(PAYLOADS.droid())]).toBe('claude');
  });

  it('Copilot multi_replace_string_in_file and create_file; Copilot CLI toolArgs as a JSON string', () => {
    const multi = extractEdits(
      { hook_event_name: 'PreToolUse', cwd: root, tool_name: 'multi_replace_string_in_file', tool_input: { replacements: [{ filePath: file, oldString: OLD, newString: NEW }, { filePath: 'other.ts', oldString: 'a', newString: 'b' }] } },
      'copilot',
      root,
    );
    expect(multi.map((e) => e.path)).toEqual([file, join(root, 'other.ts')]);
    const create = extractEdits({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'create_file', tool_input: { filePath: 'new.ts', content: 'x' } }, 'copilot', root);
    expect(create[0]).toMatchObject({ path: join(root, 'new.ts'), changedText: 'x' });
    const cli = extractEdits({ toolName: 'edit', toolArgs: JSON.stringify({ path: file, old_str: OLD, new_str: NEW }), cwd: root }, 'copilot', root);
    expect(cli[0]?.changedText).toContain('$client.end');
  });

  it('OpenCode apply_patch {patchText}, Auggie save-file, Kiro fs_append, Antigravity chunks, Cline CLI tool_call', () => {
    const patch = `*** Begin Patch\n*** Update File: db.ts\n@@\n+${TEARDOWN.split('\n').join('\n+')}\n*** End Patch`;
    expect(extractEdits({ tool_name: 'apply_patch', cwd: root, tool_input: { patchText: patch } }, 'opencode', root)[0]?.changedText).toContain('$client.end');
    expect(extractEdits({ tool_name: 'save-file', cwd: root, tool_input: { path: 'n.ts', file_content: 'y' } }, 'auggie', root)[0]).toMatchObject({ changedText: 'y' });
    expect(extractEdits({ tool_name: 'fs_append', cwd: root, tool_input: { path: file, content: TEARDOWN } }, 'kiro', root)[0]?.fileText).toBe(`${DB_TS}\n${TEARDOWN}`);
    const chunks = extractEdits(
      { toolCall: { name: 'multi_replace_file_content', args: { TargetFile: file, ReplacementChunks: [{ TargetContent: OLD, ReplacementContent: NEW }] } }, workspacePaths: [root] },
      'antigravity',
      root,
    );
    expect(chunks[0]?.changedText).toContain('$client.end');
    const clineCli = extractEdits({ hookName: 'tool_call', taskId: 't', workspaceRoots: [root], tool_call: { id: '1', name: 'editor', input: { path: file, old_text: OLD, new_text: NEW } } }, 'cline', root);
    expect(clineCli[0]?.changedText).toContain('$client.end');
  });

  it('read-only tools and non-pre-tool events are ignored', () => {
    expect(extractEdits({ tool_name: 'view', tool_input: { path: file } }, 'openhands', root)).toEqual([]);
    expect(runHook(JSON.stringify({ ...PAYLOADS.crush(), event: 'PostToolUse' }), { harness: 'crush', env: {} }).reason).toBe('not a pre-tool event');
  });

  it('--format exit2 overrides any agent (portable fallback for unknown Claude-style hooks)', () => {
    const r = runHook(JSON.stringify(PAYLOADS.droid()), { harness: 'droid', format: 'exit2', stateDir: mkdtempSync(join(tmpdir(), 'lm-state-')), env: {} });
    expect(r).toMatchObject({ stdout: '', exitCode: 2, decision: 'deny' });
  });
});

describe('install for every agent', () => {
  const CMD = 'node /opt/landmine/dist/cli.js hook';

  it('writes, is idempotent, and uninstall leaves the project clean (other config kept)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-inst-all-'));
    mkdirSync(join(dir, '.factory'));
    writeFileSync(join(dir, '.factory', 'hooks.json'), JSON.stringify({ PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt.sh' }] }] }));
    for (const h of HARNESSES) {
      expect(install(dir, h, CMD).changed).toBe(true);
      expect(install(dir, h, CMD).changed).toBe(false);
    }
    const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
    expect(read('.factory/hooks.json')).toEqual({
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt.sh' }] }],
      PreToolUse: [{ matcher: 'Create|Edit|ApplyPatch', hooks: [{ type: 'command', command: `${CMD} --harness droid`, timeout: 30 }] }],
    });
    expect(read('.devin/hooks.json')).toEqual({ hooks: { pre_write_code: [{ command: `${CMD} --harness windsurf`, show_output: false }] } });
    expect(read('.agents/hooks.json')).toMatchObject({ landmine: { PreToolUse: [{ matcher: 'write_to_file|replace_file_content|multi_replace_file_content' }] } });
    expect(read('.openhands/hooks.json')).toMatchObject({ pre_tool_use: [{ matcher: 'file_editor|apply_patch' }] });
    expect(read('.github/hooks/landmine.json')).toMatchObject({ version: 1, hooks: { PreToolUse: [{ command: `${CMD} --harness copilot`, bash: `${CMD} --harness copilot` }] } });
    expect(read('.kiro/hooks/landmine.json')).toMatchObject({ hooks: [{ name: 'landmine', trigger: 'PreToolUse', action: { command: `${CMD} --harness kiro` } }] });
    expect(read('crush.json')).toEqual({ hooks: { PreToolUse: [{ name: 'landmine', matcher: '^(edit|multiedit|write)$', command: `${CMD} --harness crush`, timeout: 10 }] } });
    expect(readFileSync(join(dir, '.opencode/plugins/landmine.ts'), 'utf8')).toContain('"tool.execute.before"');
    expect(readFileSync(join(dir, '.kilo/plugin/landmine.ts'), 'utf8')).toContain('--harness kilo --format plugin');
    expect(statSync(join(dir, '.clinerules/hooks/PreToolUse')).mode & 0o111).not.toBe(0);
    for (const h of HARNESSES) uninstall(dir, h);
    expect(read('.factory/hooks.json')).toEqual({ PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt.sh' }] }] });
    expect(read('.agents/hooks.json')).toEqual({});
    for (const f of ['.opencode/plugins/landmine.ts', '.kilo/plugin/landmine.ts', '.clinerules/hooks/PreToolUse', '.cline/plugins/landmine.ts', '.kiro/hooks/landmine.json', '.amp/plugins/landmine.ts', '.pi/extensions/landmine.ts']) {
      expect(existsSync(join(dir, f))).toBe(false);
    }
  });

  it('never overwrites a foreign file at an owned path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-inst-foreign-'));
    mkdirSync(join(dir, '.opencode', 'plugins'), { recursive: true });
    writeFileSync(join(dir, '.opencode', 'plugins', 'landmine.ts'), 'export const Mine = async () => ({})\n');
    expect(() => install(dir, 'opencode', CMD)).toThrow(/not written by landmine/);
    uninstall(dir, 'opencode');
    expect(existsSync(join(dir, '.opencode', 'plugins', 'landmine.ts'))).toBe(true);
  });

  it('auto-detects agents already configured in the project (Claude Code always)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-detect-'));
    expect(detectAgents(dir)).toEqual(['claude']);
    for (const d of ['.opencode', '.clinerules', '.kiro']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'GEMINI.md'), '');
    expect(detectAgents(dir)).toEqual(['claude', 'gemini', 'kiro', 'cline', 'opencode']);
  });

  it('MCP config for each agent in its own shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-mcp-all-'));
    const server = { command: 'node', args: ['/opt/landmine/dist/cli.js', 'mcp'] };
    for (const t of Object.keys(MCP_TARGETS) as McpTarget[]) installMcp(dir, server, t);
    expect(JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'))).toEqual({ mcp: { landmine: { type: 'local', command: ['node', '/opt/landmine/dist/cli.js', 'mcp'], enabled: true } } });
    expect(JSON.parse(readFileSync(join(dir, '.vscode/mcp.json'), 'utf8'))).toEqual({ servers: { landmine: { type: 'stdio', ...server } } });
    expect(JSON.parse(readFileSync(join(dir, '.agents/mcp.json'), 'utf8'))).toEqual({ mcpServers: { landmine: server } });
  });
});

describe('generated plugins run (OpenCode V1 calling convention, Cline plugin, Pi, Amp)', () => {
  const nodeCmd = `"${process.execPath}" "${CLI}" hook`;
  const load = async (rel: string): Promise<Record<string, unknown>> => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-plugin-'));
    install(dir, rel.startsWith('.opencode') ? 'opencode' : rel.startsWith('.cline') ? 'cline' : rel.startsWith('.pi') ? 'pi' : 'amp', nodeCmd);
    return (await import(pathToFileURL(join(dir, rel)).href)) as Record<string, unknown>;
  };

  it('OpenCode: tool.execute.before throws with the issue for the risky edit, passes others', async () => {
    const mod = await load('.opencode/plugins/landmine.ts');
    const plugin = mod.LandminePlugin as (ctx: { directory: string }) => Promise<Record<string, (i: unknown, o: unknown) => Promise<void>>>;
    const hooks = await plugin({ directory: root });
    const before = hooks['tool.execute.before'];
    if (!before) throw new Error('no hook');
    await expect(before({ tool: 'edit', sessionID: `oc-${Date.now()}` }, { args: { filePath: file, oldString: OLD, newString: NEW } })).rejects.toThrow(/drizzle-orm#3402/);
    await expect(before({ tool: 'read', sessionID: 'x' }, { args: { filePath: file } })).resolves.toBeUndefined();
  });

  it('Cline plugin returns {skip, reason}; Pi returns {block, reason}; Amp rejects and continues', async () => {
    const cline = (await load('.cline/plugins/landmine.ts')).default as { hooks: { beforeTool: (x: unknown) => unknown } };
    const prev = process.cwd();
    process.chdir(root);
    try {
      expect(cline.hooks.beforeTool({ toolCall: { toolName: 'editor' }, input: { path: file, old_text: OLD, new_text: NEW } })).toMatchObject({ skip: true });
    } finally {
      process.chdir(prev);
    }
    const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {};
    const fake = { on: (name: string, fn: (e: unknown, c: unknown) => unknown) => (handlers[name] = fn) };
    ((await load('.pi/extensions/landmine.ts')).default as (pi: unknown) => void)(fake);
    expect(handlers.tool_call?.({ toolName: 'edit', input: { path: file, edits: [{ oldText: OLD, newText: NEW }] } }, { cwd: root, sessionId: `pi-${Date.now()}` })).toMatchObject({ block: true });
    ((await load('.amp/plugins/landmine.ts')).default as (amp: unknown) => void)(fake);
    expect(handlers['tool.call']?.({ tool: 'edit_file', input: { path: file, old_str: OLD, new_str: NEW }, thread: { id: `amp-${Date.now()}` } }, { system: { workspaceRoot: root } })).toMatchObject({
      action: 'reject-and-continue',
    });
  });

  it('the Cline hook script runs and prints context', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-cline-'));
    install(dir, 'cline', nodeCmd);
    const out = execFileSync(join(dir, '.clinerules/hooks/PreToolUse'), { input: JSON.stringify(PAYLOADS.cline()), encoding: 'utf8', env: { ...process.env, LANDMINE_STATE_DIR: mkdtempSync(join(tmpdir(), 'lm-state-')) } });
    expect((JSON.parse(out) as { context: string }).context).toContain('drizzle-orm#3402');
  });
});
