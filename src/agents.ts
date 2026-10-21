import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Harness } from './hook/payload.js';
import { RULES_TARGETS } from './rules.js';

/** Files or directories whose presence says a project already uses an agent. */
const SIGNS: Record<Exclude<Harness, 'claude'>, string[]> = {
  codex: ['.codex'],
  cursor: ['.cursor'],
  gemini: ['.gemini', 'GEMINI.md'],
  copilot: ['.github/copilot-instructions.md', '.github/hooks', '.github/agents'],
  windsurf: ['.windsurf', '.devin', '.windsurfrules'],
  droid: ['.factory'],
  auggie: ['.augment'],
  kiro: ['.kiro'],
  qwen: ['.qwen', 'QWEN.md'],
  crush: ['crush.json', '.crush.json', '.crushrc'],
  goose: ['.goosehints'],
  openhands: ['.openhands'],
  trae: ['.trae'],
  antigravity: ['.agents/hooks.json', '.agents/mcp_config.json', '.agents/rules'],
  cline: ['.clinerules', '.cline'],
  opencode: ['.opencode', 'opencode.json', 'opencode.jsonc'],
  kilo: ['.kilo', 'kilo.json', 'kilo.jsonc'],
  amp: ['.amp'],
  pi: ['.pi'],
};

/** Claude Code always (Devin and Copilot CLI read its hooks too), plus every agent the project already has config for. */
export function detectAgents(root: string): Harness[] {
  const found = (Object.keys(SIGNS) as Array<keyof typeof SIGNS>).filter((h) => SIGNS[h].some((s) => existsSync(join(root, s))));
  return ['claude', ...found];
}

/** Instruction files to put the known-bugs section in: those that exist, else AGENTS.md (read by most agents). */
export function defaultRulesFiles(root: string): string[] {
  const existing = RULES_TARGETS.filter((f) => existsSync(join(root, f)));
  return existing.length ? [...existing] : ['AGENTS.md'];
}
