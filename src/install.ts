import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import type { Harness } from './hook/payload.js';

export interface InstallResult {
  file: string;
  changed: boolean;
  notes: string[];
}

type Json = Record<string, unknown>;

const IS_OURS = /\blandmines?\b[^|&;]*\bhook\b/;

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
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object; not touching it`);
  return parsed as Json;
}

function withoutOurs(list: unknown, layout: Layout, command?: string): Json[] {
  if (!Array.isArray(list)) return [];
  const ours = (c: string): boolean => IS_OURS.test(c) || (command !== undefined && c === command);
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
  hooks[layout.event] = [...withoutOurs(hooks[layout.event], layout, command), layout.build(command)];
  const next: Json = { ...(layout.topLevel ?? {}), ...config, hooks };
  const changed = JSON.stringify(next) !== before;
  if (changed) {
    mkdirSync(dirname(layout.file), { recursive: true });
    writeFileSync(layout.file, `${JSON.stringify(next, null, 2)}\n`);
  }
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
  const kept = withoutOurs(hooks[layout.event], layout);
  if (kept.length) hooks[layout.event] = kept;
  else delete hooks[layout.event];
  const changed = JSON.stringify(config) !== before;
  if (changed) writeFileSync(layout.file, `${JSON.stringify(config, null, 2)}\n`);
  return { file: layout.file, changed, notes: [] };
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
