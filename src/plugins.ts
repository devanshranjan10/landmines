/**
 * Plugin and script files `landmine install` writes for agents whose pre-edit hook is in-process code rather than a
 * shell command (docs/research/harnesses.md §3). Each one shells out to the same `landmine hook` command with a
 * Claude-shaped payload, reads `{decision, message}` (the `plugin` format) and blocks through the host's own channel.
 * They fail open: any error or timeout lets the edit through.
 */
export const MANAGED_MARKER = 'landmine-managed';

/** Shared JS (valid TypeScript too) that runs the hook and returns its decision. */
function core(command: string, harness: string): string {
  return `import { execSync } from "node:child_process";

// ${MANAGED_MARKER}: written by \`landmine install --harness ${harness}\`; \`landmine uninstall\` removes it.
const LANDMINE_COMMAND = ${JSON.stringify(`${command} --harness ${harness} --format plugin`)};

function landmine(tool: string, input: unknown, cwd: string, session: string): { decision: string; message: string } | undefined {
  try {
    const payload = JSON.stringify({ hook_event_name: "PreToolUse", session_id: session, cwd, tool_name: tool, tool_input: input });
    const out = execSync(LANDMINE_COMMAND, { cwd, input: payload, timeout: 10_000, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    if (!out) return undefined;
    const parsed = JSON.parse(out) as { decision?: unknown; message?: unknown };
    return typeof parsed.message === "string" ? { decision: String(parsed.decision), message: parsed.message } : undefined;
  } catch {
    return undefined; // never get in the agent's way
  }
}
`;
}

/** OpenCode (V1 plugin API, also loaded by Kilo Code): throwing in tool.execute.before fails that one tool call. */
export function opencodePlugin(command: string, harness: 'opencode' | 'kilo'): string {
  return `${core(command, harness)}
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch", "patch", "multiedit"]);

export const LandminePlugin = async ({ directory }: { directory: string }) => ({
  "tool.execute.before": async (input: { tool: string; sessionID?: string }, output: { args: unknown }) => {
    if (!EDIT_TOOLS.has(input.tool)) return;
    const r = landmine(input.tool, output.args, directory, input.sessionID ?? "");
    if (r?.decision === "deny") throw new Error(r.message);
  },
});
`;
}

/** Cline CLI plugin (`.cline/plugins/`): beforeTool returning `{skip, reason}` blocks one call; the reason reaches the model. */
export function clinePlugin(command: string): string {
  return `${core(command, 'cline')}
const EDIT_TOOLS = new Set(["editor", "apply_patch", "write_to_file", "replace_in_file"]);
// One plugin instance lives as long as one Cline run, so this stands in for a session id.
const SESSION = "cline-" + String(process.pid) + "-" + String(Date.now());

export default {
  name: "landmine",
  manifest: { capabilities: ["hooks"] },
  hooks: {
    beforeTool({ toolCall, input }: { toolCall: { toolName?: string; name?: string; id?: string }; input: unknown }) {
      const tool = toolCall.toolName ?? toolCall.name ?? "";
      if (!EDIT_TOOLS.has(tool)) return undefined;
      const r = landmine(tool, input, process.cwd(), SESSION);
      return r?.decision === "deny" ? { skip: true, reason: r.message } : undefined;
    },
  },
};
`;
}

/** Amp plugin: `tool.call` returning reject-and-continue sends the message to the model. */
export function ampPlugin(command: string): string {
  return `${core(command, 'amp')}
const EDIT_TOOLS = new Set(["edit_file", "create_file", "apply_patch"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function (amp: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  amp.on("tool.call", (event: any, ctx: any) => {
    if (!EDIT_TOOLS.has(event.tool)) return { action: "allow" };
    const cwd = ctx?.system?.workspaceRoot ?? process.cwd();
    const r = landmine(event.tool, event.input, cwd, event.thread?.id ?? "");
    return r?.decision === "deny" ? { action: "reject-and-continue", message: r.message } : { action: "allow" };
  });
}
`;
}

/** Pi (and oh-my-pi) extension: returning `{block, reason}` from tool_call blocks it. */
export function piExtension(command: string): string {
  return `${core(command, 'pi')}
const EDIT_TOOLS = new Set(["edit", "write"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function (pi: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pi.on("tool_call", (event: any, ctx: any) => {
    if (!EDIT_TOOLS.has(event.toolName)) return undefined;
    const r = landmine(event.toolName, event.input, ctx?.cwd ?? process.cwd(), ctx?.sessionId ?? "");
    return r?.decision === "deny" ? { block: true, reason: r.message } : undefined;
  });
}
`;
}

/** Cline file hook (VS Code and CLI): an executable named PreToolUse. It can only add context, never fail one call. */
export function clineHookScript(command: string): string {
  return `#!/bin/sh
# ${MANAGED_MARKER}: written by \`landmine install --harness cline\`; \`landmine uninstall\` removes it.
exec ${command} --harness cline
`;
}
