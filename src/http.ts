import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every network call goes through this, so tests can inject recorded responses. */
export interface Http {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export const liveHttp: Http = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

interface Recording {
  request: { method: string; url: string; body?: string };
  response: { status: number; headers: Record<string, string>; body: string };
}

const KEPT_HEADERS = ['content-type', 'retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-resource', 'x-ratelimit-limit'];

function requestKey(method: string, url: string, body: string | undefined): string {
  const hash = createHash('sha1').update(`${method} ${url}\n${body ?? ''}`).digest('hex').slice(0, 16);
  const u = new URL(url);
  const slug = `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 80);
  return `${slug}-${hash}`;
}

function bodyText(init: RequestInit | undefined): string | undefined {
  const b = init?.body;
  if (b === undefined || b === null) return undefined;
  if (typeof b === 'string') return b;
  throw new Error('Only string request bodies are supported by the recorder');
}

/** Wraps a real Http and writes every exchange to `dir` (no request headers, so no tokens). */
export function recordingHttp(dir: string, inner: Http = liveHttp): Http {
  mkdirSync(dir, { recursive: true });
  return {
    async fetch(url, init) {
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = bodyText(init);
      const res = await inner.fetch(url, init);
      const text = await res.text();
      const headers: Record<string, string> = {};
      for (const h of KEPT_HEADERS) {
        const v = res.headers.get(h);
        if (v !== null) headers[h] = v;
      }
      const rec: Recording = { request: { method, url, ...(body === undefined ? {} : { body }) }, response: { status: res.status, headers, body: text } };
      writeFileSync(join(dir, `${requestKey(method, url, body)}.json`), `${JSON.stringify(rec, null, 2)}\n`);
      return new Response(text, { status: res.status, headers });
    },
  };
}

/** Serves recorded exchanges; throws on anything that was not recorded. */
export function replayHttp(dir: string): Http {
  return {
    fetch(url, init) {
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = bodyText(init);
      const file = join(dir, `${requestKey(method, url, body)}.json`);
      let rec: Recording;
      try {
        rec = JSON.parse(readFileSync(file, 'utf8')) as Recording;
      } catch {
        return Promise.reject(new Error(`No recorded response for ${method} ${url} (expected ${file})`));
      }
      return Promise.resolve(new Response(rec.response.body, { status: rec.response.status, headers: rec.response.headers }));
    },
  };
}

/** In-memory fake for unit tests: route by `METHOD url` prefix. */
export function fakeHttp(handler: (method: string, url: string, body: string | undefined) => Response | Promise<Response>): Http {
  return {
    fetch: async (url, init) => handler((init?.method ?? 'GET').toUpperCase(), url, bodyText(init)),
  };
}
