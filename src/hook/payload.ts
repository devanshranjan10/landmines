import { readFileSync, statSync } from 'node:fs';
import { langForPath } from '../source/lang.js';
import { isAbsolute, resolve } from 'node:path';
import { parseApplyPatch } from './patch.js';

export type Harness = 'claude' | 'codex' | 'cursor' | 'gemini';
export const HARNESSES: readonly Harness[] = ['claude', 'codex', 'cursor', 'gemini'];

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

export function detectHarness(p: Payload): Harness {
  if ('cursor_version' in p) return 'cursor';
  const tool = str(p.tool_name);
  if (p.hook_event_name === 'BeforeTool' || tool === 'write_file' || tool === 'replace') return 'gemini';
  if (tool === 'apply_patch' || 'turn_id' in p) return 'codex';
  return 'claude';
}

/** Is this a pre-edit event we should look at? (Other events, e.g. PostToolUse, are ignored.) */
export function isPreToolEvent(p: Payload): boolean {
  const e = str(p.hook_event_name);
  return e === undefined || e === 'PreToolUse' || e === 'preToolUse' || e === 'BeforeTool';
}

export function sessionKey(p: Payload, now: Date): string {
  return str(p.session_id) ?? str(p.conversation_id) ?? `no-session-${now.toISOString().slice(0, 10)}`;
}

/** Directory the agent works in, for resolving relative paths and finding the index. */
export function workDir(p: Payload, env: NodeJS.ProcessEnv): string {
  const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots.filter((r): r is string => typeof r === 'string') : [];
  return str(p.cwd) ?? env.CLAUDE_PROJECT_DIR ?? env.GEMINI_PROJECT_DIR ?? roots[0] ?? process.cwd();
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

/** What each harness's payload says the agent is about to write. */
export function extractEdits(p: Payload, harness: Harness, cwd: string, read: ReadFile = readFileOrUndefined): EditTarget[] {
  const input = obj(p.tool_input);
  const tool = str(p.tool_name) ?? '';
  const abs = (path: string): string => (isAbsolute(path) ? path : resolve(cwd, path));

  if (harness === 'codex') {
    const patch = typeof p.tool_input === 'string' ? p.tool_input : (str(input.command) ?? str(input.patch) ?? str(input.input));
    if (!patch) return [];
    return parseApplyPatch(patch)
      .filter((f) => f.kind !== 'delete')
      .map((f) => {
        const path = abs(f.movedTo ?? f.path);
        const changedText = f.added.join('\n');
        const disk = f.kind === 'update' ? read(abs(f.path)) : undefined;
        return { path, changedText, fileText: disk === undefined ? changedText : `${disk}\n${changedText}` };
      });
  }

  const filePath = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  if (!filePath || tool === 'NotebookEdit') return [];
  const path = abs(filePath);
  const content = str(input.content);
  const oldString = str(input.old_string);
  const newString = str(input.new_string);
  const edits = Array.isArray(input.edits) ? input.edits.map(obj) : undefined;

  if (content !== undefined) {
    const prev = read(path);
    return [{ path, fileText: content, changedText: addedLines(prev, content) }];
  }
  if (edits) {
    let text = read(path);
    const changed: string[] = [];
    for (const e of edits) {
      const o = str(e.old_string) ?? '';
      const n = str(e.new_string) ?? '';
      text = applyReplace(text, o, n, e.replace_all === true);
      changed.push(n);
    }
    return [{ path, fileText: text ?? changed.join('\n'), changedText: changed.join('\n') }];
  }
  if (newString !== undefined) {
    const all = input.replace_all === true || input.allow_multiple === true;
    return [{ path, fileText: applyReplace(read(path), oldString ?? '', newString, all), changedText: newString }];
  }
  return [];
}
