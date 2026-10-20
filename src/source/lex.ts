export type Lang = 'js' | 'py';

export interface StringLiteral {
  /** Offset of the opening quote. */
  start: number;
  /** Offset just past the closing quote (or end of line if unterminated). */
  end: number;
  value: string;
}

export interface Lexed {
  /** Same length as the input; comments and string contents replaced by spaces, newlines kept. */
  code: string;
  strings: StringLiteral[];
}

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Tolerant lexer. Never throws: unterminated strings end at the line break,
 * unterminated block comments run to the end. Good enough to find imports and
 * identifier chains in half-written code.
 */
export function lex(text: string, lang: Lang): Lexed {
  return lang === 'py' ? lexPython(text) : lexJs(text);
}

function blankRange(chars: string[], from: number, to: number): void {
  for (let k = from; k < to; k++) if (chars[k] !== '\n') chars[k] = ' ';
}

function lexJs(text: string): Lexed {
  // split('') keeps UTF-16 offsets aligned with the input string.
  const out = text.split('');
  const strings: StringLiteral[] = [];
  const n = text.length;
  let i = 0;
  let prev = ''; // previous significant character
  let prevWordEnd = 0;
  const braceStack: number[] = []; // template literal nesting: depth markers
  let braceDepth = 0;

  const readQuoted = (quote: string): void => {
    const start = i;
    i++;
    let value = '';
    while (i < n && text[i] !== quote && text[i] !== '\n') {
      if (text[i] === '\\') {
        value += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      value += text[i];
      i++;
    }
    if (text[i] === quote) i++;
    blankRange(out, start + 1, Math.max(start + 1, i - 1));
    strings.push({ start, end: i, value });
    prev = quote;
  };

  const readTemplate = (): void => {
    // Called with i at the backtick or at the `}` closing a ${} expression.
    const start = i;
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        blankRange(out, start + 1, i);
        i++;
        prev = '`';
        return;
      }
      if (c === '$' && text[i + 1] === '{') {
        blankRange(out, start + 1, i);
        i += 2;
        braceStack.push(braceDepth);
        braceDepth = 0;
        prev = '{';
        return;
      }
      i++;
    }
    blankRange(out, start + 1, n);
  };

  while (i < n) {
    const c = text[i] ?? '';
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const start = i;
      while (i < n && text[i] !== '\n') i++;
      blankRange(out, start, i);
      continue;
    }
    if (c === '/' && next === '*') {
      const start = i;
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      blankRange(out, start, i);
      continue;
    }
    if (c === '"' || c === "'") {
      readQuoted(c);
      continue;
    }
    if (c === '`') {
      readTemplate();
      continue;
    }
    if (c === '{') {
      braceDepth++;
      prev = c;
      i++;
      continue;
    }
    if (c === '}') {
      if (braceDepth === 0 && braceStack.length > 0) {
        braceDepth = braceStack.pop() ?? 0;
        readTemplate();
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      prev = c;
      i++;
      continue;
    }
    if (c === '/') {
      const before = text.slice(Math.max(0, prevWordEnd - 12), prevWordEnd);
      const isRegex = REGEX_PRECEDERS.has(prev) || (/[\w$]/.test(prev) && REGEX_KEYWORDS.test(before));
      if (isRegex) {
        const start = i;
        i++;
        let inClass = false;
        while (i < n && text[i] !== '\n') {
          const r = text[i];
          if (r === '\\') {
            i += 2;
            continue;
          }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(text[i] ?? '')) i++;
        blankRange(out, start + 1, Math.max(start + 1, i - 1));
        prev = 'a';
        continue;
      }
    }
    if (!/\s/.test(c)) {
      prev = c;
      if (/[\w$]/.test(c)) prevWordEnd = i + 1;
    }
    i++;
  }
  return { code: out.join(''), strings };
}

function lexPython(text: string): Lexed {
  const out = text.split('');
  const strings: StringLiteral[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i] ?? '';
    if (c === '#') {
      const start = i;
      while (i < n && text[i] !== '\n') i++;
      blankRange(out, start, i);
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      const start = i;
      i += quote.length;
      let value = '';
      while (i < n) {
        if (text[i] === '\\') {
          value += text[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (text.startsWith(quote, i)) break;
        if (!triple && text[i] === '\n') break;
        value += text[i];
        i++;
      }
      const closed = text.startsWith(quote, i);
      const contentEnd = i;
      if (closed) i += quote.length;
      blankRange(out, start + quote.length, contentEnd);
      strings.push({ start, end: i, value });
      continue;
    }
    i++;
  }
  return { code: out.join(''), strings };
}

/** Find the string literal whose opening quote is at `offset`. */
export function stringAt(strings: StringLiteral[], offset: number): StringLiteral | undefined {
  // strings are in ascending order; binary search
  let lo = 0;
  let hi = strings.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = strings[mid];
    if (!s) break;
    if (s.start === offset) return s;
    if (s.start < offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}
