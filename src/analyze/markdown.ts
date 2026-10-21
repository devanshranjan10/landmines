export interface Fence {
  info: string;
  code: string;
}

/** Remove HTML comments, images and raw tags; keep the text. */
export function stripNoise(md: string): string {
  return removeHtmlComments(md)
    .replace(/!\[[^\]\n]{0,300}\]\([^)\n]{0,1000}\)/g, '')
    .replace(/<img[^>\n]{0,1000}>/gi, '')
    .replace(/<\/?(details|summary|p|br|div|span|sub|sup|b|i|strong|em|kbd|a)\b[^>\n]{0,300}>/gi, '')
    .replace(/\r\n/g, '\n');
}

/** `<!-- … -->` removal by scanning, not regex (an unterminated `<!--` is dropped to the end, like GitHub does). */
function removeHtmlComments(md: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const start = md.indexOf('<!--', i);
    if (start < 0) return out + md.slice(i);
    out += md.slice(i, start);
    const end = md.indexOf('-->', start + 4);
    if (end < 0) return out;
    i = end + 3;
  }
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

/** Inline code spans with the sentence each one sits in. */
export function codeSpansInContext(prose: string): Array<{ span: string; sentence: string }> {
  const out: Array<{ span: string; sentence: string }> = [];
  for (const m of prose.matchAll(/(`{1,2})([^`\n]+?)\1(?!`)/g)) {
    const v = m[2]?.trim();
    if (!v) continue;
    const i = m.index ?? 0;
    const start = Math.max(prose.lastIndexOf('. ', i), prose.lastIndexOf('\n', i)) + 1;
    const endDot = prose.indexOf('. ', i + m[0].length);
    const endNl = prose.indexOf('\n', i + m[0].length);
    const end = Math.min(endDot < 0 ? prose.length : endDot, endNl < 0 ? prose.length : endNl);
    out.push({ span: v, sentence: prose.slice(start, end) });
  }
  return out;
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
  return md.replace(/^[ \t]*[-*][ \t]+\[[ xX]\][ \t].*$/gm, '');
}

/** Remove quoted replies (`> ...`), which repeat other people's text. */
export function dropQuotes(md: string): string {
  return md.replace(/^[ \t]*>.*$/gm, '');
}
