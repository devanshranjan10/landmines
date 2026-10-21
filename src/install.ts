import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import type { Harness } from './hook/payload.js';
import { MANAGED_MARKER, ampPlugin, clineHookScript, clinePlugin, opencodePlugin, piExtension } from './plugins.js';
import { INDEX_DIR } from './store.js';
import { parseJsonc } from './util/jsonc.js';

export interface InstallResult {
  file: string;
  changed: boolean;
  notes: string[];
}

type Json = Record<string, unknown>;

/**
 * Commands landmine itself writes: `npx -y landmines@x hook`, `landmine hook` (bin on PATH), or
 * `node ".../landmine(s)/dist/cli.js" hook`. Deliberately narrow, so `/home/u/landmine-api/pre-commit-hook.sh`
 * and other people's hooks are never touched. Custom `--command`s are tracked in .landmine/installed.json.
 */
const IS_OURS = [
  /(?:^|\s)npx\s+(?:-y\s+|--yes\s+)*landmines(?:@\S+)?\s+hook(?:\s|$)/,
  /(?:^|[\s"'])landmines?\s+hook(?:\s|$)/,
  /[\\/]landmines?[\\/]dist[\\/]cli\.js["']?\s+hook(?:\s|$)/,
  /#landmine hook$/,
];
const isOurs = (command: string, registry: Set<string>): boolean =>
  registry.has(command) || [...registry].some((c) => command.startsWith(`${c} --harness `)) || IS_OURS.some((re) => re.test(command));

const STATUS = 'landmine: checking for known open bugs';

/** The command of a hook handler, plus its statusMessage so a custom `--command` is still recognisable. */
const commandOf = (v: unknown): string => {
  if (typeof v !== 'object' || v === null) return '';
  const { command, statusMessage, action } = v as Json;
  const nested = typeof action === 'object' && action !== null ? (action as Json).command : undefined;
  const cmd = typeof command === 'string' ? command : typeof nested === 'string' ? nested : '';
  return `${cmd}${statusMessage === STATUS ? ' #landmine hook' : ''}`;
};

/** A hook entry merged into a JSON config the agent and the user share. */
interface JsonLayout {
  kind: 'json';
  file: string;
  /** Keys from the config root to the object whose `event` key holds the hook list. */
  path: string[];
  event: string;
  build: (command: string) => Json;
  topLevel?: Json;
  notes: string[];
}

/** Files landmine owns outright (plugins, scripts, a dedicated hooks file), marked so uninstall can find them. */
interface OwnedLayout {
  kind: 'owned';
  files: Array<{ file: string; content: (command: string) => string; executable?: boolean }>;
  notes: string[];
}

type Layout = JsonLayout | OwnedLayout;

const nestedEntry = (matcher: string, hook: Json) => (command: string): Json => ({ matcher, hooks: [{ type: 'command', command, ...hook }] });

/** How to wire landmine into each agent at project level (docs/research/harnesses.md). */
function layouts(root: string): Record<Harness, Layout> {
  const p = (...parts: string[]): string => join(root, ...parts);
  const json = (file: string, path: string[], event: string, build: (c: string) => Json, notes: string[], topLevel?: Json): JsonLayout => ({
    kind: 'json',
    file,
    path,
    event,
    build,
    notes,
    ...(topLevel ? { topLevel } : {}),
  });
  const ownedJson = (file: string, body: (c: string) => Json, notes: string[]): OwnedLayout => ({
    kind: 'owned',
    files: [{ file, content: (c) => `${JSON.stringify(body(c), null, 2)}\n` }],
    notes,
  });
  return {
    claude: json(
      p('.claude', 'settings.json'),
      ['hooks'],
      'PreToolUse',
      // edit/write/apply_patch: Devin CLI reads this file with lowercase tool names. Harmless for Claude Code.
      (command) => ({ matcher: 'Edit|Write|MultiEdit|edit|write|apply_patch', hooks: [{ type: 'command', command, timeout: 10, statusMessage: STATUS }] }),
      [
        'Claude Code picks up hook changes immediately. landmine runs before Edit/Write and blocks once per issue per session.',
        'Devin CLI and Copilot CLI also run hooks from .claude/settings.json. Cursor imports it too, but shows the reason to the user rather than the agent: use --harness cursor for Cursor.',
      ],
    ),
    codex: json(p('.codex', 'hooks.json'), ['hooks'], 'PreToolUse', nestedEntry('^apply_patch$', { timeout: 10 }), [
      'Codex only runs project hooks you have trusted: open Codex in this project, run /hooks, and trust the landmine hook.',
    ]),
    cursor: json(p('.cursor', 'hooks.json'), ['hooks'], 'preToolUse', (command) => ({ command, matcher: 'Write', timeout: 10 }), [
      'Cursor also imports .claude/settings.json (third-party hooks); with both installed landmine runs twice per edit but still blocks only once.',
    ], { version: 1 }),
    gemini: json(
      p('.gemini', 'settings.json'),
      ['hooks'],
      'BeforeTool',
      (command) => ({ matcher: 'write_file|replace', hooks: [{ name: 'landmine', type: 'command', command, timeout: 10000 }] }),
      ['Built from Gemini CLI docs; not run against a live Gemini CLI.', 'Gemini CLI warns before running project hooks for the first time.'],
    ),
    copilot: json(
      p('.github', 'hooks', 'landmine.json'),
      ['hooks'],
      'PreToolUse',
      (command) => ({
        type: 'command',
        command,
        bash: command,
        matcher: 'Edit|Write|edit|create|apply_patch|replace_string_in_file|multi_replace_string_in_file|create_file|insert_edit_into_file',
        timeout: 15,
        timeoutSec: 15,
      }),
      [
        'Read by GitHub Copilot in VS Code (agent mode, needs Workspace Trust) and Copilot CLI. Copilot CLI also runs .claude/settings.json hooks: install only one of the two for it.',
      ],
      { version: 1 },
    ),
    windsurf: json(p('.devin', 'hooks.json'), ['hooks'], 'pre_write_code', (command) => ({ command, show_output: false }), [
      'Windsurf / Devin Desktop (Cascade) runs pre_write_code hooks; the reason reaches the agent through stderr and exit code 2. Built from docs.',
    ]),
    droid: json(p('.factory', 'hooks.json'), [], 'PreToolUse', nestedEntry('Create|Edit|ApplyPatch', { timeout: 30 }), ['Factory Droid project hooks. Built from docs.']),
    auggie: json(p('.augment', 'settings.json'), ['hooks'], 'PreToolUse', nestedEntry('str-replace-editor|save-file|apply_patch', { timeout: 10000 }), [
      'Auggie (Augment CLI). Built from docs and its bundle schema.',
    ]),
    kiro: ownedJson(
      p('.kiro', 'hooks', 'landmine.json'),
      (command) => ({
        version: 'v1',
        hooks: [{ name: 'landmine', trigger: 'PreToolUse', matcher: '^(fs_write|fs_append|str_replace)$', action: { type: 'command', command: `${command} --harness kiro` }, timeout: 30 }],
      }),
      ['Kiro sends stderr to the model on exit code 2. Built from docs; the edit tools\' argument names are not documented.'],
    ),
    qwen: json(p('.qwen', 'settings.json'), ['hooks'], 'PreToolUse', nestedEntry('edit|write_file|Edit|Write', { timeout: 10 }), [
      'Qwen Code loads project hooks only in trusted folders.',
    ]),
    crush: json(p('crush.json'), ['hooks'], 'PreToolUse', (command) => ({ name: 'landmine', matcher: '^(edit|multiedit|write)$', command, timeout: 10 }), [
      'Crush project hooks (crush.json). Built from source.',
    ]),
    goose: {
      kind: 'owned',
      files: [
        { file: p('.agents', 'plugins', 'landmine', 'plugin.json'), content: () => `${JSON.stringify({ name: 'landmine', version: '1', description: `Known open bugs in pinned dependencies (${MANAGED_MARKER})`, hooks: 'hooks/hooks.json' }, null, 2)}\n` },
        {
          file: p('.agents', 'plugins', 'landmine', 'hooks', 'hooks.json'),
          content: (command) => `${JSON.stringify({ hooks: { PreToolUse: [nestedEntry('^(write|edit)$', { timeout: 10 })(`${command} --harness goose`)] } }, null, 2)}\n`,
        },
      ],
      notes: ['Goose plugin hooks. The plugin manifest shape is inferred from docs; verify Goose lists the plugin.'],
    },
    openhands: json(p('.openhands', 'hooks.json'), [], 'pre_tool_use', nestedEntry('file_editor|apply_patch', { timeout: 10 }), [
      'OpenHands uses the first hooks.json it finds: this project file now shadows ~/.openhands/hooks.json.',
    ]),
    trae: json(p('.trae', 'hooks.json'), ['hooks'], 'PreToolUse', nestedEntry('Write|Edit', { timeout: 10 }), ['Trae: enable the hook in Trae\'s hook settings. Built from docs.'], { version: 1 }),
    antigravity: json(
      p('.agents', 'hooks.json'),
      ['landmine'],
      'PreToolUse',
      nestedEntry('write_to_file|replace_file_content|multi_replace_file_content', { timeout: 10 }),
      ['Antigravity project hooks. Built from docs; not run live.'],
    ),
    cline: {
      kind: 'owned',
      files: [
        { file: p('.clinerules', 'hooks', 'PreToolUse'), content: clineHookScript, executable: true },
        { file: p('.cline', 'plugins', 'landmine.ts'), content: clinePlugin },
      ],
      notes: [
        'Cline CLI: the plugin in .cline/plugins blocks one edit and sends the reason to the model.',
        'Cline file hooks (.clinerules/hooks, VS Code: enable Hooks in settings) can only add context, so there the issue arrives as a warning before the next step.',
      ],
    },
    opencode: { kind: 'owned', files: [{ file: p('.opencode', 'plugins', 'landmine.ts'), content: (c) => opencodePlugin(c, 'opencode') }], notes: ['OpenCode loads .opencode/plugins/*.ts at startup.'] },
    kilo: { kind: 'owned', files: [{ file: p('.kilo', 'plugin', 'landmine.ts'), content: (c) => opencodePlugin(c, 'kilo') }], notes: ['Kilo Code (CLI and VS Code) loads .kilo/plugin/*.ts.'] },
    amp: { kind: 'owned', files: [{ file: p('.amp', 'plugins', 'landmine.ts'), content: ampPlugin }], notes: ['Amp plugin. Built from the plugin API typings; not run live.'] },
    pi: { kind: 'owned', files: [{ file: p('.pi', 'extensions', 'landmine.ts'), content: piExtension }], notes: ['Pi loads project extensions after you trust the project.'] },
  };
}

function readJson(file: string): Json {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    let jsonc = false;
    try {
      parseJsonc(text);
      jsonc = true;
    } catch {
      // not JSONC either
    }
    // Rewriting would silently drop the user's comments, so stop and say what to add by hand.
    throw new Error(
      jsonc ? `${file} contains comments; landmine will not rewrite it. Add the hook entry by hand (see README).` : `${file} is not valid JSON; not touching it`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object; not touching it`);
  return parsed as Json;
}

/** An owned file is ours if it is missing, carries the marker, or is a landmine-named JSON hook file. */
function ownedByUs(file: string): boolean {
  if (!existsSync(file)) return true;
  if (/[\\/]plugins[\\/]landmine[\\/]/.test(file)) return true;
  const text = readFileSync(file, 'utf8');
  return text.includes(MANAGED_MARKER) || /"name":\s*"landmine"/.test(text);
}

/** Throws if installing into this harness would fail, before anything is written. */
export function preflight(root: string, harness: Harness): void {
  const layout = layouts(root)[harness];
  if (layout.kind === 'json') readJson(layout.file);
  else for (const f of layout.files) if (!ownedByUs(f.file)) throw new Error(`${f.file} exists and was not written by landmine; not touching it`);
}

const REGISTRY = join(INDEX_DIR, 'installed.json');

function readRegistry(root: string): Record<string, string[]> {
  try {
    const r = JSON.parse(readFileSync(join(root, REGISTRY), 'utf8')) as unknown;
    return typeof r === 'object' && r !== null ? (r as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeRegistry(root: string, reg: Record<string, string[]>): void {
  mkdirSync(join(root, INDEX_DIR), { recursive: true });
  writeFileSync(join(root, REGISTRY), `${JSON.stringify(reg, null, 2)}\n`);
}

/** Commands in one entry of a hook list: the entry's own, plus those of nested handlers. */
function entryCommands(entry: Json): string[] {
  return [commandOf(entry), ...(Array.isArray(entry.hooks) ? entry.hooks.map(commandOf) : [])].filter(Boolean);
}

function withoutOurs(list: unknown, registry: Set<string>): Json[] {
  if (!Array.isArray(list)) return [];
  const ours = (c: string): boolean => isOurs(c, registry);
  return list
    .filter((e): e is Json => typeof e === 'object' && e !== null)
    .map((entry) => {
      if (!Array.isArray(entry.hooks)) return entry;
      return { ...entry, hooks: entry.hooks.filter((h: unknown) => !ours(commandOf(h))) };
    })
    .filter((entry) => !entryCommands(entry).some(ours) && !(Array.isArray(entry.hooks) && entry.hooks.length === 0));
}

/** The object at `path` inside `config`, created if missing. */
function container(config: Json, path: string[]): Json {
  let node = config;
  for (const key of path) {
    const next = node[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) node[key] = {};
    node = node[key] as Json;
  }
  return node;
}

/** The command written for a harness: Claude's is left bare so Cursor's import of .claude can still auto-detect. */
export function commandFor(harness: Harness, command: string): string {
  return harness === 'claude' ? command : `${command} --harness ${harness}`;
}

/** Add (or replace) landmine's hook for one agent; other hooks are left alone. */
export function install(root: string, harness: Harness, baseCommand: string): InstallResult {
  const layout = layouts(root)[harness];
  const reg = readRegistry(root);
  const remember = (): void => {
    if (!(reg[harness] ?? []).includes(baseCommand)) writeRegistry(root, { ...reg, [harness]: [...(reg[harness] ?? []), baseCommand] });
  };
  if (layout.kind === 'owned') {
    let changed = false;
    for (const f of layout.files) {
      if (!ownedByUs(f.file)) throw new Error(`${f.file} exists and was not written by landmine; not touching it`);
      // Plugins embed the base command and add their own --harness; the Cline script too.
      const text = f.content(baseCommand);
      if (!existsSync(f.file) || readFileSync(f.file, 'utf8') !== text) {
        mkdirSync(dirname(f.file), { recursive: true });
        writeFileSync(f.file, text);
        changed = true;
      }
      if (f.executable) chmodSync(f.file, 0o755);
    }
    remember();
    return { file: layout.files.map((f) => f.file).join(', '), changed, notes: layout.notes };
  }
  const command = commandFor(harness, baseCommand);
  const config = readJson(layout.file);
  const before = JSON.stringify(config);
  const holder = container(config, layout.path);
  holder[layout.event] = [...withoutOurs(holder[layout.event], new Set([...(reg[harness] ?? []), baseCommand])), layout.build(command)];
  const next: Json = { ...(layout.topLevel ?? {}), ...config };
  const changed = JSON.stringify(next) !== before;
  if (changed) {
    mkdirSync(dirname(layout.file), { recursive: true });
    writeFileSync(layout.file, `${JSON.stringify(next, null, 2)}\n`);
  }
  remember();
  return { file: layout.file, changed, notes: layout.notes };
}

/** Remove landmine's hook entries (or owned files) only. */
export function uninstall(root: string, harness: Harness): InstallResult {
  const layout = layouts(root)[harness];
  const reg = readRegistry(root);
  const forget = (): void => {
    if (reg[harness]) {
      delete reg[harness];
      writeRegistry(root, reg);
    }
  };
  if (layout.kind === 'owned') {
    let changed = false;
    for (const f of layout.files) {
      if (existsSync(f.file) && ownedByUs(f.file)) {
        rmSync(f.file);
        changed = true;
      }
    }
    forget();
    return { file: layout.files.map((f) => f.file).join(', '), changed, notes: [] };
  }
  if (!existsSync(layout.file)) return { file: layout.file, changed: false, notes: [] };
  const config = readJson(layout.file);
  const before = JSON.stringify(config);
  let holder: Json | undefined = config;
  for (const key of layout.path) {
    const next: unknown = holder?.[key];
    holder = typeof next === 'object' && next !== null && !Array.isArray(next) ? (next as Json) : undefined;
  }
  if (!holder) return { file: layout.file, changed: false, notes: [] };
  const kept = withoutOurs(holder[layout.event], new Set(reg[harness] ?? []));
  if (kept.length) holder[layout.event] = kept;
  else delete holder[layout.event];
  // An Antigravity-style `{ "landmine": {} }` wrapper that is now empty goes too.
  if (layout.path.length === 1 && layout.path[0] === 'landmine' && Object.keys(holder).length === 0) delete config.landmine;
  const changed = JSON.stringify(config) !== before;
  if (changed) writeFileSync(layout.file, `${JSON.stringify(config, null, 2)}\n`);
  forget();
  return { file: layout.file, changed, notes: [] };
}

/** The MCP server command, as `.mcp.json` / `claude mcp add` want it (no shell quoting). */
export function mcpCommand(opts: { execPath: string; script: string; version: string; pathEnv?: string }): { command: string; args: string[] } {
  if (/[\\/]_npx[\\/]/.test(opts.script)) return { command: 'npx', args: ['-y', `landmines@${opts.version}`, 'mcp'] };
  const node = preferredNode(opts.execPath, opts.pathEnv);
  return { command: node === 'node' ? 'node' : opts.execPath, args: [opts.script, 'mcp'] };
}

/** Project-level MCP config files and the shape each agent expects (docs/research/harnesses.md §4). */
export const MCP_TARGETS = {
  claude: { file: '.mcp.json', key: 'mcpServers', shape: 'stdio' },
  cursor: { file: '.cursor/mcp.json', key: 'mcpServers', shape: 'plain' },
  gemini: { file: '.gemini/settings.json', key: 'mcpServers', shape: 'plain' },
  qwen: { file: '.qwen/settings.json', key: 'mcpServers', shape: 'plain' },
  copilot: { file: '.vscode/mcp.json', key: 'servers', shape: 'stdio' },
  droid: { file: '.factory/mcp.json', key: 'mcpServers', shape: 'plain' },
  kiro: { file: '.kiro/settings/mcp.json', key: 'mcpServers', shape: 'plain' },
  trae: { file: '.trae/mcp.json', key: 'mcpServers', shape: 'plain' },
  antigravity: { file: '.agents/mcp_config.json', key: 'mcpServers', shape: 'plain' },
  freebuff: { file: '.agents/mcp.json', key: 'mcpServers', shape: 'plain' },
  roo: { file: '.roo/mcp.json', key: 'mcpServers', shape: 'plain' },
  warp: { file: '.warp/.mcp.json', key: 'mcpServers', shape: 'plain' },
  pi: { file: '.pi/mcp.json', key: 'mcpServers', shape: 'plain' },
  opencode: { file: 'opencode.json', key: 'mcp', shape: 'opencode' },
  kilo: { file: 'kilo.json', key: 'mcp', shape: 'opencode' },
  crush: { file: 'crush.json', key: 'mcp', shape: 'stdio' },
} as const;
export type McpTarget = keyof typeof MCP_TARGETS;

/** Add landmine to an agent's project MCP config. Other servers are kept. */
export function installMcp(root: string, server: { command: string; args: string[] }, target: McpTarget = 'claude'): InstallResult {
  const t = MCP_TARGETS[target];
  const file = join(root, t.file);
  const config = readJson(file);
  const before = JSON.stringify(config);
  const servers = typeof config[t.key] === 'object' && config[t.key] !== null && !Array.isArray(config[t.key]) ? (config[t.key] as Json) : {};
  servers.landmine =
    t.shape === 'opencode'
      ? { type: 'local', command: [server.command, ...server.args], enabled: true }
      : t.shape === 'stdio'
        ? { type: 'stdio', command: server.command, args: server.args }
        : { command: server.command, args: server.args };
  const next = { ...config, [t.key]: servers };
  const changed = JSON.stringify(next) !== before;
  if (changed) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return {
    file,
    changed,
    notes: ['MCP tools: landmine_check, landmine_search, landmine_list.', `User-level agents (Codex, Windsurf, Cline, Goose): add \`${[server.command, ...server.args].join(' ')}\` as a stdio MCP server.`],
  };
}

/**
 * `node` when the `node` on PATH is this same binary (survives `brew upgrade`, nvm switches the user
 * expects), otherwise the absolute path of the running Node.
 */
export function preferredNode(execPath: string, pathEnv: string | undefined): string {
  const real = (p: string): string | undefined => {
    try {
      return realpathSync(p);
    } catch {
      return undefined;
    }
  };
  const self = real(execPath);
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = real(join(dir, process.platform === 'win32' ? 'node.exe' : 'node'));
    if (candidate) return candidate === self ? 'node' : `"${execPath}"`;
  }
  return `"${execPath}"`;
}

/** The command a harness should run. Stable installs get an absolute script path; npx runs get a pinned npx call. */
export function hookCommand(opts: { execPath: string; script: string; version: string; mode: 'block' | 'warn'; headsUp?: boolean; pathEnv?: string }): string {
  const suffix = `${opts.mode === 'warn' ? ' --mode warn' : ''}${opts.headsUp && opts.mode === 'block' ? ' --heads-up' : ''}`;
  if (/[\\/]_npx[\\/]/.test(opts.script)) return `npx -y landmines@${opts.version} hook${suffix}`;
  return `${preferredNode(opts.execPath, opts.pathEnv)} "${opts.script}" hook${suffix}`;
}
