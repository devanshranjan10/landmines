import type { Harness } from './payload.js';

export type HookMode = 'block' | 'warn';

/**
 * The JSON a harness expects on stdout. `undefined` means print nothing (normal flow).
 * landmine never prints "allow": that would skip the user's own permission prompts.
 */
export function respond(harness: Harness, mode: HookMode, message: string): string | undefined {
  if (!message) return undefined;
  const claudeDeny = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message };
  switch (harness) {
    case 'claude':
    case 'codex':
      return JSON.stringify({
        hookSpecificOutput: mode === 'block' ? claudeDeny : { hookEventName: 'PreToolUse', additionalContext: message },
      });
    case 'cursor':
      // Cursor runs this hook either natively or through its import of .claude/settings.json; carry both shapes.
      // Warn mode has no documented pre-edit context field in Cursor, so it stays silent.
      if (mode === 'warn') return undefined;
      return JSON.stringify({ permission: 'deny', user_message: message, agent_message: message, hookSpecificOutput: claudeDeny });
    case 'gemini':
      // BeforeTool has no additionalContext; a deny reason is sent to the model as a tool error.
      if (mode === 'warn') return undefined;
      return JSON.stringify({ decision: 'deny', reason: message });
  }
}
