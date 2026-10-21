import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import type { Harness } from './hook/payload.js';
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
const isOurs = (command: string, registry: Set<string>): boolean => registry.has(command) || IS_OURS.some((re) => re.test(command));

const STATUS = 'landmine: checking for known open bugs';

/** The command of a hook handler, plus its statusMessage so a custom `--command` is still recognisable. */
const commandOf = (v: unknown): string => {
  if (typeof v !== 'object' || v === null) return '';
  const { command, statusMessage } = v as Json;
  return `${typeof command === 'string' ? command : ''}${statusMessage === STATUS ? ' #landmine hook' : ''}`;
};

interface Layout {
  file: string;
  event: string;
  build: (command: string) => Json;
  /** Pull the command strings out of one entry under hooks[event]. */
  commands: (entry: Json) => string[];
  notes: string[];
  topLevel?: Json;
}

function layouts(root: string): Record<Harness, Layout> {
  const nested = (entry: Json): string[] =>
    Array.isArray(entry.hooks) ? entry.hooks.map(commandOf) : [];
  return {
    claude: {
      file: join(root, '.claude', 'settings.json'),
      event: 'PreToolUse',
      build: (command) => ({ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command, timeout: 10, statusMessage: STATUS }] }),
      commands: nested,
      notes: [
        'Claude Code picks up hook changes immediately. landmine runs before Edit/Write and blocks once per issue per session.',
        'Cursor also runs hooks from .claude/settings.json by default (third-party hooks), so this covers Cursor too.',
      ],
    },
    codex: {
      file: join(root, '.codex', 'hooks.json'),
      event: 'PreToolUse',
      build: (command) => ({ matcher: '^apply_patch$', hooks: [{ type: 'command', command, timeout: 10 }] }),
      commands: nested,
      notes: ['Codex only runs project hooks you have trusted: open Codex in this project, run /hooks, and trust the landmine hook.'],
    },
    cursor: {
      file: join(root, '.cursor', 'hooks.json'),
      event: 'preToolUse',
      build: (command) => ({ command, matcher: 'Write', timeout: 10 }),
      commands: (entry) => [commandOf(entry)],
      topLevel: { version: 1 },
      notes: [
        'Cursor already imports hooks from .claude/settings.json unless third-party hooks are turned off; with both installed landmine runs twice per edit (it still blocks only once).',
      ],
    },
    gemini: {
      file: join(root, '.gemini', 'settings.json'),
      event: 'BeforeTool',
      build: (command) => ({ matcher: 'write_file|replace', hooks: [{ name: 'landmine', type: 'command', command, timeout: 10000 }] }),
      commands: nested,
      notes: ['Gemini CLI support follows its documented hook format but has not been tested against a live Gemini CLI.', 'Gemini CLI warns before running project hooks for the first time.'],
    },
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

/** Throws if installing into this harness would fail, before anything is written. */
export function preflight(root: string, harness: Harness): void {
  readJson(layouts(root)[harness].file);
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

function withoutOurs(list: unknown, layout: Layout, registry: Set<string>): Json[] {
  if (!Array.isArray(list)) return [];
  const ours = (c: string): boolean => isOurs(c, registry);
  return list
    .filter((e): e is Json => typeof e === 'object' && e !== null)
    .map((entry) => {
      if (!Array.isArray(entry.hooks)) return entry;
      return { ...entry, hooks: entry.hooks.filter((h: unknown) => !ours(commandOf(h))) };
    })
    .filter((entry) => !layout.commands(entry).some(ours) && !(Array.isArray(entry.hooks) && entry.hooks.length === 0));
}

/** Add (or replace) landmine's hook entry; other hooks are left alone. */
export function install(root: string, harness: Harness, command: string): InstallResult {
  const layout = layouts(root)[harness];
  const config = readJson(layout.file);
  const before = JSON.stringify(config);
  const hooks = typeof config.hooks === 'object' && config.hooks !== null && !Array.isArray(config.hooks) ? (config.hooks as Json) : {};
  const reg = readRegistry(root);
  const known = new Set([...(reg[harness] ?? []), command]);
  hooks[layout.event] = [...withoutOurs(hooks[layout.event], layout, known), layout.build(command)];
  const next: Json = { ...(layout.topLevel ?? {}), ...config, hooks };
  const changed = JSON.stringify(next) !== before;
  if (changed) {
    mkdirSync(dirname(layout.file), { recursive: true });
    writeFileSync(layout.file, `${JSON.stringify(next, null, 2)}\n`);
  }
  if (!(reg[harness] ?? []).includes(command)) writeRegistry(root, { ...reg, [harness]: [...(reg[harness] ?? []), command] });
  return { file: layout.file, changed, notes: layout.notes };
}

/** Remove landmine's hook entries only. */
export function uninstall(root: string, harness: Harness): InstallResult {
  const layout = layouts(root)[harness];
  if (!existsSync(layout.file)) return { file: layout.file, changed: false, notes: [] };
  const config = readJson(layout.file);
  const before = JSON.stringify(config);
  const hooks = typeof config.hooks === 'object' && config.hooks !== null && !Array.isArray(config.hooks) ? (config.hooks as Json) : undefined;
  if (!hooks) return { file: layout.file, changed: false, notes: [] };
  const reg = readRegistry(root);
  const kept = withoutOurs(hooks[layout.event], layout, new Set(reg[harness] ?? []));
  if (kept.length) hooks[layout.event] = kept;
  else delete hooks[layout.event];
  const changed = JSON.stringify(config) !== before;
  if (changed) writeFileSync(layout.file, `${JSON.stringify(config, null, 2)}\n`);
  if (reg[harness]) {
    delete reg[harness];
    writeRegistry(root, reg);
  }
  return { file: layout.file, changed, notes: [] };
}

/** The MCP server command, as `.mcp.json` / `claude mcp add` want it (no shell quoting). */
export function mcpCommand(opts: { execPath: string; script: string; version: string; pathEnv?: string }): { command: string; args: string[] } {
  if (/[\\/]_npx[\\/]/.test(opts.script)) return { command: 'npx', args: ['-y', `landmines@${opts.version}`, 'mcp'] };
  const node = preferredNode(opts.execPath, opts.pathEnv);
  return { command: node === 'node' ? 'node' : opts.execPath, args: [opts.script, 'mcp'] };
}

/** Add landmine to the project's `.mcp.json` (Claude Code project-scope MCP servers). Other servers are kept. */
export function installMcp(root: string, server: { command: string; args: string[] }): InstallResult {
  const file = join(root, '.mcp.json');
  const config = readJson(file);
  const before = JSON.stringify(config);
  const servers = typeof config.mcpServers === 'object' && config.mcpServers !== null && !Array.isArray(config.mcpServers) ? (config.mcpServers as Json) : {};
  servers.landmine = { type: 'stdio', command: server.command, args: server.args };
  const next = { ...config, mcpServers: servers };
  const changed = JSON.stringify(next) !== before;
  if (changed) writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return { file, changed, notes: ['MCP tools: landmine_check, landmine_search, landmine_list. For Codex: codex mcp add landmine -- ' + [server.command, ...server.args].join(' ')] };
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
