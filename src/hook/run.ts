import { appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Hit, fileContext, matchTouches } from '../match.js';
import { MAX_HITS, modelMessage } from '../message.js';
import { langForPath } from '../source/lang.js';
import { touches } from '../source/touches.js';
import { findIndexRoot, readIndex } from '../store.js';
import type { LandmineIndex } from '../types.js';
import { type Harness, type ReadFile, detectHarness, extractEdits, isPreToolEvent, readFileOrUndefined, sessionKey, workDir } from './payload.js';
import { type HookMode, respond } from './respond.js';
import { ShownState } from './state.js';

export interface HookOptions {
  mode?: HookMode;
  /** In block mode, also pass uncorroborated matches to the model as non-blocking context. Off by default (D-29). */
  headsUp?: boolean;
  harness?: Harness;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  stateDir?: string;
  read?: ReadFile;
}

export interface HookResult {
  stdout: string;
  harness?: Harness;
  decision: 'none' | 'deny' | 'context';
  hits: Array<{ id: string; symbol: string; file: string }>;
  reason?: string;
}

/** Evaluate one hook invocation. Never throws: any problem means "print nothing". */
export function runHook(stdin: string, opts: HookOptions = {}): HookResult {
  const env = opts.env ?? process.env;
  const result = evaluate(stdin, opts, env);
  const log = env.LANDMINE_DEBUG_LOG;
  if (log) {
    try {
      appendFileSync(log, `${JSON.stringify({ time: new Date().toISOString(), ...result, payload: safeParse(stdin) })}\n`);
    } catch {
      // logging is best effort
    }
  }
  return result;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 2000);
  }
}

function evaluate(stdin: string, opts: HookOptions, env: NodeJS.ProcessEnv): HookResult {
  const none = (reason: string, harness?: Harness): HookResult => ({ stdout: '', decision: 'none', hits: [], reason, ...(harness ? { harness } : {}) });
  try {
    const parsed: unknown = JSON.parse(stdin);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return none('payload is not a JSON object');
    const payload = parsed as Record<string, unknown>;
    const harness = opts.harness ?? detectHarness(payload);
    if (!isPreToolEvent(payload)) return none('not a pre-tool event', harness);
    const cwd = workDir(payload, env);
    const edits = extractEdits(payload, harness, cwd, opts.read ?? readFileOrUndefined);
    if (edits.length === 0) return none('no file edit in payload', harness);

    const indexes = new Map<string, LandmineIndex | undefined>();
    const hits: Array<Hit & { file: string; root: string }> = [];
    for (const edit of edits) {
      const lang = langForPath(edit.path);
      if (!lang) continue;
      const root = findIndexRoot(dirname(edit.path)) ?? findIndexRoot(cwd);
      if (!root) continue;
      if (!indexes.has(root)) indexes.set(root, readIndex(root));
      const index = indexes.get(root);
      if (!index) continue;
      const found = touches({ fileText: edit.fileText, changedText: edit.changedText, lang });
      for (const h of matchTouches(found, index, lang, fileContext(edit.fileText, lang))) {
        if (!hits.some((x) => x.landmine.id === h.landmine.id)) hits.push({ ...h, file: edit.path, root });
      }
    }
    if (hits.length === 0) return none('no landmine touched', harness);
    hits.sort((a, b) => b.rank - a.rank);

    const mode = opts.mode ?? 'block';
    const session = sessionKey(payload, (opts.now ?? (() => new Date()))());
    const stateFor = (h: (typeof hits)[number]): ShownState => new ShownState(h.root, session, opts.stateDir ?? env.LANDMINE_STATE_DIR);
    const unseen = hits.filter((h) => !stateFor(h).has(h.landmine.id));
    const summary = hits.map((h) => ({ id: h.landmine.id, symbol: h.symbol, file: h.file }));
    if (unseen.length === 0) return { stdout: '', harness, decision: 'none', hits: summary, reason: 'already shown this session' };

    // Block only on corroborated hits. A bare symbol match was relevant ~7% of the time on held-out real code
    // (docs/ACCURACY.md), so it is dropped unless heads-ups are on; it does not use up the issue's one showing.
    const corroborated = unseen.filter((h) => h.corroboratedBy);
    const blocking = mode === 'block' && corroborated.length > 0;
    if (mode === 'block' && !blocking && !opts.headsUp) {
      return { stdout: '', harness, decision: 'none', hits: summary, reason: 'only uncorroborated matches (heads-up off)' };
    }
    // Cursor and Gemini CLI have no non-blocking pre-edit channel: a heads-up there prints nothing, so it must
    // not use up the issue's one showing either.
    const outputMode = blocking ? 'block' : 'warn';
    if (respond(harness, outputMode, 'probe') === undefined) {
      return { stdout: '', harness, decision: 'none', hits: summary, reason: 'heads-up only, and this harness has no way to pass context without blocking' };
    }
    // Claim only what is shown (at most MAX_HITS), so anything beyond it can still be shown on a later edit.
    const candidates = blocking ? corroborated : unseen;
    const fresh: typeof hits = [];
    for (const h of candidates) {
      if (fresh.length >= MAX_HITS) break;
      if (stateFor(h).claim(h.landmine.id)) fresh.push(h);
    }
    if (fresh.length === 0) return { stdout: '', harness, decision: 'none', hits: summary, reason: 'already shown this session' };

    const messageMode = blocking ? 'block' : mode === 'warn' ? 'warn' : 'heads-up';
    const stdout = respond(harness, outputMode, modelMessage(fresh, messageMode)) ?? '';
    return {
      stdout,
      harness,
      decision: stdout ? (blocking ? 'deny' : 'context') : 'none',
      hits: fresh.map((h) => ({ id: h.landmine.id, symbol: h.symbol, file: h.file })),
    };
  } catch (err) {
    return none(`internal error: ${(err as Error).message}`);
  }
}
