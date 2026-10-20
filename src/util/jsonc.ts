/** Parse JSON with comments and trailing commas (bun.lock, tsconfig-style). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      out += text.slice(start, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === ',') {
      const j = skipTrivia(text, i + 1);
      if (text[j] === '}' || text[j] === ']') {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return JSON.parse(out);
}

/** Index of the next character that is not whitespace or a comment. */
function skipTrivia(text: string, from: number): number {
  let j = from;
  for (;;) {
    while (j < text.length && /\s/.test(text[j] ?? '')) j++;
    if (text[j] === '/' && text[j + 1] === '/') {
      while (j < text.length && text[j] !== '\n') j++;
    } else if (text[j] === '/' && text[j + 1] === '*') {
      const end = text.indexOf('*/', j + 2);
      j = end < 0 ? text.length : end + 2;
    } else return j;
  }
}
