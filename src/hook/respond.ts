import type { Harness } from './payload.js';

export type HookMode = 'block' | 'warn';

/**
 * How an agent wants to hear "stop and reconsider" (docs/research/harnesses.md):
 * - `claude`: `hookSpecificOutput.permissionDecision: "deny"` (+ `additionalContext` for warnings). Claude Code, Codex,
 *   Copilot, Droid, Auggie, Qwen Code, Crush, Trae and other Claude-compatible hooks.
 * - `cursor`: `{permission:"deny", agent_message}` (also carries the Claude shape for Cursor's .claude import).
 * - `deny`: `{decision:"deny", reason}`. Gemini CLI, Antigravity, OpenHands.
 * - `block`: `{decision:"block", reason}`. Goose.
 * - `exit2`: the reason on stderr and exit code 2. Windsurf/Devin, Kiro, and the most portable fallback.
 * - `cline`: `{context}`: Cline injects it before the next request. Its file hooks cannot fail a single tool call
 *   (`cancel` ends the whole task), so block mode becomes a strong warning there; the Cline plugin can block.
 * - `plugin`: `{decision, message}` for landmine's own plugin files (OpenCode, Kilo, Cline plugin, Amp, Pi).
 */
export type Format = 'claude' | 'cursor' | 'deny' | 'block' | 'exit2' | 'cline' | 'plugin';
export const FORMATS: readonly Format[] = ['claude', 'cursor', 'deny', 'block', 'exit2', 'cline', 'plugin'];

export const FORMAT_FOR: Record<Harness, Format> = {
  claude: 'claude',
  codex: 'claude',
  cursor: 'cursor',
  gemini: 'deny',
  copilot: 'claude',
  windsurf: 'exit2',
  droid: 'claude',
  auggie: 'claude',
  kiro: 'exit2',
  qwen: 'claude',
  crush: 'claude',
  goose: 'block',
  openhands: 'deny',
  trae: 'claude',
  antigravity: 'deny',
  cline: 'cline',
  opencode: 'plugin',
  kilo: 'plugin',
  amp: 'plugin',
  pi: 'plugin',
};

export interface HookOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Formats that can pass a warning to the model without stopping the edit. The in-process plugins (OpenCode, Kilo,
 * Cline, Amp, Pi) can only block or allow a tool call, so a warning there would be silently dropped.
 */
export function canWarn(format: Format): boolean {
  return format === 'claude' || format === 'cline';
}

/**
 * What to print for a decision. `undefined` means print nothing (normal flow).
 * landmine never prints "allow": that would skip the user's own permission prompts.
 */
export function respond(format: Format, mode: HookMode, message: string): HookOutput | undefined {
  if (!message) return undefined;
  const out = (stdout: string, stderr = '', exitCode = 0): HookOutput => ({ stdout, stderr, exitCode });
  const claudeDeny = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message };
  if (mode === 'warn' && !canWarn(format)) return undefined;
  switch (format) {
    case 'claude':
      return out(JSON.stringify({ hookSpecificOutput: mode === 'block' ? claudeDeny : { hookEventName: 'PreToolUse', additionalContext: message } }));
    case 'cursor':
      return out(JSON.stringify({ permission: 'deny', user_message: message, agent_message: message, hookSpecificOutput: claudeDeny }));
    case 'deny':
      return out(JSON.stringify({ decision: 'deny', reason: message }));
    case 'block':
      return out(JSON.stringify({ decision: 'block', reason: message }));
    case 'exit2':
      return out('', message, 2);
    case 'cline':
      return out(JSON.stringify({ cancel: false, context: message }));
    case 'plugin':
      return out(JSON.stringify({ decision: mode === 'block' ? 'deny' : 'context', message }));
  }
}
