import { extname } from 'node:path';
import type { Lang } from './lex.js';

const JS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro']);
const PY = new Set(['.py', '.pyi']);

export function langForPath(path: string): Lang | undefined {
  const ext = extname(path).toLowerCase();
  if (JS.has(ext)) return 'js';
  if (PY.has(ext)) return 'py';
  return undefined;
}

/** Language of a Markdown code fence from its info string; undefined when unknown. */
export function langForFence(info: string): Lang | undefined {
  const tag = info.trim().split(/[\s{]/)[0]?.toLowerCase() ?? '';
  if (/^(js|jsx|ts|tsx|javascript|typescript|mjs|cjs|vue|svelte|astro)$/.test(tag)) return 'js';
  if (/^(py|python|python3|pycon|ipython)$/.test(tag)) return 'py';
  return undefined;
}
