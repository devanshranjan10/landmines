import { readFileSync, statSync } from 'node:fs';
import { langForPath } from '../source/lang.js';
import { isAbsolute, resolve } from 'node:path';
import { parseApplyPatch } from './patch.js';

/**
 * Every agent landmine knows how to talk to. Payload shapes, deny formats and config paths are in
 * docs/research/harnesses.md; `src/harnesses.ts` holds the per-agent install and output details.
 */
export const HARNESSES = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'copilot',
  'windsurf',
  'droid',
  'auggie',
  'kiro',
  'qwen',
  'crush',
  'goose',
  'openhands',
  'trae',
  'antigravity',
  'cline',
  'opencode',
  'kilo',
  'amp',
  'pi',
] as const;
export type Harness = (typeof HARNESSES)[number];

export type Payload = Record<string, unknown>;

export interface EditTarget {
  /** Absolute path of the file being edited. */
  path: string;
  /** The file as it will look after the edit (used to find imports). */
  fileText: string;
  /** Only what the edit introduces. */
  changedText: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const first = (...vs: unknown[]): string | undefined => vs.map(str).find((v) => v !== undefined && v !== '');
const firstOf = (o: Record<string, unknown>, keys: readonly string[]): string | undefined => first(...keys.map((k) => o[k]));
const arr0 = (v: unknown): string | undefined => (Array.isArray(v) ? first(...(v as unknown[])) : undefined);

/** The parts of a pre-tool payload landmine needs, whatever the agent calls them. */
export interface Envelope {
  event?: string;
  tool: string;
  /** Tool arguments: an object, or a raw patch string (Codex). */
  input: unknown;
  session?: string;
  cwd?: string;
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{')) return v;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return v;
  }
}

export function envelope(p: Payload): Envelope {
  const toolCall = obj(p.toolCall);
  const clineCall = obj(p.tool_call);
  const pre = obj(p.preToolUse);
  const tool =
    first(p.tool_name, p.toolName, p.tool, toolCall.name, clineCall.name, pre.toolName) ?? (p.agent_action_name === 'pre_write_code' ? 'pre_write_code' : '');
  const input =
    p.tool_input !== undefined
      ? p.tool_input
      : p.toolArgs !== undefined
        ? parseMaybeJson(p.toolArgs)
        : p.args !== undefined
          ? p.args
          : toolCall.args !== undefined
            ? toolCall.args
            : clineCall.input !== undefined
              ? clineCall.input
              : pre.parameters !== undefined
                ? pre.parameters
                : p.tool_info;
  const thread = obj(p.thread);
  return {
    ...(first(p.hook_event_name, p.event, p.event_type, p.hookName, p.agent_action_name) ? { event: first(p.hook_event_name, p.event, p.event_type, p.hookName, p.agent_action_name) } : {}),
    tool,
    input,
    ...(first(p.session_id, p.sessionId, p.sessionID, p.conversation_id, p.conversationId, p.trajectory_id, p.taskId, thread.id)
      ? { session: first(p.session_id, p.sessionId, p.sessionID, p.conversation_id, p.conversationId, p.trajectory_id, p.taskId, thread.id) }
      : {}),
    ...(first(p.cwd, p.working_dir, p.working_directory, arr0(p.workspace_roots), arr0(p.workspaceRoots), arr0(p.workspacePaths))
      ? { cwd: first(p.cwd, p.working_dir, p.working_directory, arr0(p.workspace_roots), arr0(p.workspaceRoots), arr0(p.workspacePaths)) }
      : {}),
  };
}

/** Best guess when the hook command does not say (`--harness`). Installs always say. */
export function detectHarness(p: Payload): Harness {
  if ('cursor_version' in p) return 'cursor';
  if (p.agent_action_name === 'pre_write_code' || 'trajectory_id' in p) return 'windsurf';
  if ('toolCall' in p && ('conversationId' in p || 'workspacePaths' in p)) return 'antigravity';
  if ('preToolUse' in p || ('hookName' in p && 'tool_call' in p)) return 'cline';
  if ('event_type' in p && 'working_dir' in p) return 'openhands';
  const tool = str(p.tool_name);
  if (p.hook_event_name === 'BeforeTool' || tool === 'write_file' || tool === 'replace') return 'gemini';
  if (tool === 'apply_patch' || 'turn_id' in p) return 'codex';
  return 'claude';
}

const PRE_TOOL_EVENTS = new Set(['pretooluse', 'beforetool', 'pretool', 'pretoolcall', 'toolcall', 'prewritecode', 'toolexecutebefore']);

/** Is this a pre-edit event we should look at? (Other events, e.g. PostToolUse, are ignored.) */
export function isPreToolEvent(p: Payload): boolean {
  const e = envelope(p).event;
  return e === undefined || PRE_TOOL_EVENTS.has(e.toLowerCase().replace(/[^a-z]/g, ''));
}

export function sessionKey(p: Payload, now: Date): string {
  return envelope(p).session ?? `no-session-${now.toISOString().slice(0, 10)}`;
}

const PROJECT_DIR_VARS = [
  'CLAUDE_PROJECT_DIR',
  'GEMINI_PROJECT_DIR',
  'QWEN_PROJECT_DIR',
  'AUGMENT_PROJECT_DIR',
  'FACTORY_PROJECT_DIR',
  'CRUSH_PROJECT_DIR',
  'TRAE_PROJECT_DIR',
  'DEVIN_PROJECT_DIR',
  'OPENHANDS_PROJECT_DIR',
  'CURSOR_PROJECT_DIR',
];

/** Directory the agent works in, for resolving relative paths and finding the index. */
export function workDir(p: Payload, env: NodeJS.ProcessEnv): string {
  return envelope(p).cwd ?? PROJECT_DIR_VARS.map((v) => env[v]).find((v) => v) ?? process.cwd();
}

export type ReadFile = (path: string) => string | undefined;

/** Larger files are not read: the hook has a few seconds, and nobody hand-edits 2 MB of source. */
export const MAX_FILE_BYTES = 2_000_000;

/** Read a source file the hook can analyse. Never blocks on FIFOs or devices, never reads huge files. */
export const readFileOrUndefined: ReadFile = (path) => {
  try {
    if (!langForPath(path)) return undefined;
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

function applyReplace(old: string | undefined, oldString: string, newString: string, all: boolean): string {
  if (old === undefined) return newString;
  if (oldString && old.includes(oldString)) return all ? old.split(oldString).join(newString) : old.replace(oldString, () => newString);
  return `${old}\n${newString}`;
}

/** Lines of `next` that are not in `prev` (multiset difference); everything when the file is new. */
export function addedLines(prev: string | undefined, next: string): string {
  if (prev === undefined) return next;
  const counts = new Map<string, number>();
  for (const l of prev.split(/\r?\n/)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const out: string[] = [];
  for (const l of next.split(/\r?\n/)) {
    const n = counts.get(l) ?? 0;
    if (n > 0) counts.set(l, n - 1);
    else out.push(l);
  }
  return out.join('\n');
}

// Field names each agent uses for the same things (docs/research/harnesses.md §Step 0).
const PATH_KEYS = ['file_path', 'filePath', 'filepath', 'path', 'TargetFile', 'target_file', 'notebook_path'] as const;
const CONTENT_KEYS = ['content', 'file_text', 'file_content', 'CodeContent', 'contents'] as const;
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['old_string', 'new_string'],
  ['oldString', 'newString'],
  ['old_str', 'new_str'],
  ['old_text', 'new_text'],
  ['oldText', 'newText'],
  ['before', 'after'],
  ['TargetContent', 'ReplacementContent'],
];
const LIST_KEYS = ['edits', 'replacements', 'ReplacementChunks'] as const;
const PATCH_KEYS = ['patchText', 'patch', 'input', 'command'] as const;
const NOT_EDITS = new Set(['notebookedit', 'read', 'read_file', 'view', 'glob', 'grep', 'ls', 'list', 'bash', 'shell', 'run_shell_command', 'webfetch', 'fetch', 'search']);

const looksLikePatch = (s: string): boolean => /^\*\*\* (Begin Patch|Add File:|Update File:)/m.test(s);

function pairOf(o: Record<string, unknown>): { old: string; next: string } | undefined {
  for (const [a, b] of PAIRS) {
    const next = str(o[b]);
    if (next !== undefined) return { old: str(o[a]) ?? '', next };
  }
  return undefined;
}

/** Auggie's str-replace-editor numbers its pairs: old_str_1/new_str_1, old_str_2/new_str_2… */
function numberedPairs(o: Record<string, unknown>): Array<{ old: string; next: string }> {
  const out: Array<{ old: string; next: string }> = [];
  for (let i = 1; i <= 50; i++) {
    const next = str(o[`new_str_${i}`]);
    if (next === undefined) break;
    out.push({ old: str(o[`old_str_${i}`]) ?? '', next });
  }
  return out;
}

function fromPatch(patch: string, abs: (p: string) => string, read: ReadFile): EditTarget[] {
  return parseApplyPatch(patch)
    .filter((f) => f.kind !== 'delete')
    .map((f) => {
      const path = abs(f.movedTo ?? f.path);
      const changedText = f.added.join('\n');
      const disk = f.kind === 'update' ? read(abs(f.path)) : undefined;
      return { path, changedText, fileText: disk === undefined ? changedText : `${disk}\n${changedText}` };
    });
}

/** What the payload says the agent is about to write, for any supported agent. */
export function extractEdits(p: Payload, harness: Harness, cwd: string, read: ReadFile = readFileOrUndefined): EditTarget[] {
  const env = envelope(p);
  const tool = env.tool;
  if (NOT_EDITS.has(tool.toLowerCase())) return [];
  const abs = (path: string): string => (isAbsolute(path) ? path : resolve(cwd, path));

  // Patches: Codex apply_patch (string input or {command}), OpenCode apply_patch {patchText}, Copilot/Cline {input}…
  if (typeof env.input === 'string') return looksLikePatch(env.input) ? fromPatch(env.input, abs, read) : [];
  const input = obj(env.input);
  for (const k of PATCH_KEYS) {
    const v = str(input[k]);
    if (v && looksLikePatch(v)) return fromPatch(v, abs, read);
  }
  if (harness === 'codex') return [];

  // Copilot's multi_replace_string_in_file: each replacement carries its own file.
  const lists = LIST_KEYS.map((k) => input[k]).find(Array.isArray) as unknown[] | undefined;
  const filePath = firstOf(input, PATH_KEYS);
  if (!filePath && lists) {
    const byFile = new Map<string, Array<{ old: string; next: string }>>();
    for (const item of lists.map(obj)) {
      const fp = firstOf(item, PATH_KEYS);
      const pair = pairOf(item);
      if (fp && pair) byFile.set(fp, [...(byFile.get(fp) ?? []), pair]);
    }
    return [...byFile].map(([fp, pairs]) => applyPairs(abs(fp), pairs, read));
  }
  if (!filePath || 'notebook_path' in input) return [];
  const path = abs(filePath);

  const content = firstOf(input, CONTENT_KEYS);
  if (content !== undefined) {
    const prev = read(path);
    // Appends (Kiro fs_append) add to the end; everything else replaces the file.
    if (/append/i.test(tool) || input.command === 'append') return [{ path, fileText: `${prev ?? ''}\n${content}`, changedText: content }];
    return [{ path, fileText: content, changedText: addedLines(prev, content) }];
  }
  // Copilot insert_edit_into_file sends a sketch with "...existing code..." markers: only the new text is reliable.
  const sketch = str(input.code);
  if (sketch !== undefined) {
    const prev = read(path);
    return [{ path, fileText: `${prev ?? ''}\n${sketch}`, changedText: sketch }];
  }
  if (lists) {
    const pairs = lists
      .map(obj)
      .map((e) => {
        const pair = pairOf(e);
        return pair ? { ...pair, all: e.replace_all === true } : undefined;
      })
      .filter((x): x is { old: string; next: string; all: boolean } => x !== undefined);
    if (pairs.length) return [applyPairs(path, pairs, read)];
  }
  const numbered = numberedPairs(input);
  if (numbered.length) return [applyPairs(path, numbered, read)];
  const pair = pairOf(input);
  if (pair) {
    const all = input.replace_all === true || input.replaceAll === true || input.allow_multiple === true || input.AllowMultiple === true;
    return [{ path, fileText: applyReplace(read(path), pair.old, pair.next, all), changedText: pair.next }];
  }
  return [];
}

function applyPairs(path: string, pairs: Array<{ old: string; next: string; all?: boolean }>, read: ReadFile): EditTarget {
  let text = read(path);
  for (const { old, next, all } of pairs) text = applyReplace(text, old, next, all === true);
  const changed = pairs.map((x) => x.next).join('\n');
  return { path, fileText: text ?? changed, changedText: changed };
}
