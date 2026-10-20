export interface Fence {
  info: string;
  code: string;
}

/** Remove HTML comments, images and raw tags; keep the text. */
export function stripNoise(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?(details|summary|p|br|div|span|sub|sup|b|i|strong|em|kbd|a)\b[^>]*>/gi, '')
    .replace(/\r\n/g, '\n');
}

/** Split Markdown into prose (fences replaced by blank lines) and fenced code blocks. */
export function splitFences(md: string): { prose: string; fences: Fence[] } {
  const fences: Fence[] = [];
  const prose = md.replace(/^( {0,3})(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:^\1\2[`~]*[ \t]*$|(?![\s\S]))/gm, (_m, _indent, _fence, info: string, code: string) => {
    fences.push({ info: info.trim(), code });
    return '\n';
  });
  return { prose, fences };
}

/** Inline code spans (single or double backticks). */
export function codeSpans(prose: string): string[] {
  const out: string[] = [];
  for (const m of prose.matchAll(/(`{1,2})([^`\n]+?)\1(?!`)/g)) {
    const v = m[2]?.trim();
    if (v) out.push(v);
  }
  return out;
}

/** Drop GitHub task-list lines (issue-template checkboxes). */
export function dropTaskLists(md: string): string {
  return md.replace(/^\s*[-*]\s+\[[ xX]\]\s.*$/gm, '');
}

/** Remove quoted replies (`> ...`), which repeat other people's text. */
export function dropQuotes(md: string): string {
  return md.replace(/^\s*>.*$/gm, '');
}
