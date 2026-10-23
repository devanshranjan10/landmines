// landmine.tech edge:
// - http:// and www. redirect to https://landmine.tech;
// - agents that ask for Markdown (Accept: text/markdown) get the page's .md twin;
// - HTML pages advertise that twin in a Link header;
// - /media/ files answer byte-range requests (static assets don't, and Safari won't play a video without them);
// - /mcp is the hosted MCP server (src/remote.ts): Streamable HTTP, no sign-in, rate-limited per IP;
// - /api/lookup?q=next@16.4.0 is the same lookup as JSON, for the live lookup on the home page;
// - everything else is served from static assets.
import { createRemoteHandler, edgeCache, lookupForSite } from '../../src/remote.ts';

const HOST = 'landmine.tech';
const MARKDOWN = { '/': '/index.md', '/docs/': '/docs.md', '/benchmark/': '/benchmark.md', '/faq/': '/faq.md' };

function wantsMarkdown(accept) {
  if (!accept) return false;
  const q = (type) => {
    const m = accept.split(',').map((s) => s.trim()).find((s) => s.split(';')[0].trim() === type);
    if (!m) return -1;
    const v = /;\s*q=([\d.]+)/.exec(m);
    return v ? Number(v[1]) : 1;
  };
  return q('text/markdown') > Math.max(q('text/html'), 0);
}

/** Serve one `Range: bytes=a-b` slice of a static asset as 206; anything else gets the whole file. */
async function ranged(request, env) {
  const res = await env.ASSETS.fetch(request);
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (request.method !== 'GET' || !res.ok || !m || (m[1] === '' && m[2] === '')) {
    const out = new Response(res.body, res);
    out.headers.set('Accept-Ranges', 'bytes');
    return out;
  }
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const out = new Response(buf.slice(start, end + 1), { status: 206, headers: res.headers });
  out.headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  out.headers.set('Content-Length', String(end - start + 1));
  out.headers.set('Accept-Ranges', 'bytes');
  return out;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

let mcp;

function jsonRpcError(status, message) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function serveMcp(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // A person opening the URL in a browser gets the setup instructions, not a protocol error.
  const accept = request.headers.get('accept') ?? '';
  if (request.method === 'GET' && accept.includes('text/html') && !accept.includes('text/event-stream')) {
    return Response.redirect(`https://${HOST}/docs/#remote-mcp`, 302);
  }
  if (request.method === 'POST' && (await limited(request, env))) {
    return jsonRpcError(429, 'Too many requests to landmine.tech/mcp; wait a minute. For heavy use, run `npx landmines mcp` locally.');
  }
  mcp ??= createRemoteHandler(remoteEnv(env));
  const res = await mcp.fetch(request);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

function remoteEnv(env) {
  return {
    githubToken: env.GITHUB_TOKEN,
    http: { fetch: (url, init) => fetch(url, { signal: AbortSignal.timeout(15_000), ...init }) },
    cache: edgeCache(caches.default),
  };
}

async function limited(request, env) {
  if (!env.MCP_LIMIT) return false;
  const { success } = await env.MCP_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
  return !success;
}

async function serveLookupApi(request, env) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'GET /api/lookup?q=next@16.4.0' }, 405);
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const specs = q.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (specs.length === 0 || q.length > 600) return json({ error: 'Pass ?q= with exact versions, like next@16.4.0 or pandas==2.3.1.' }, 400);
  if (await limited(request, env)) return json({ error: 'Too many lookups from your network; wait a minute.' }, 429);
  const results = await lookupForSite(remoteEnv(env), specs);
  return 'error' in results ? json(results, 503) : json({ results });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' || url.hostname === `www.${HOST}`) {
      url.protocol = 'https:';
      url.hostname = HOST;
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/mcp' || url.pathname === '/mcp/') return serveMcp(request, env);
    if (url.pathname === '/api/lookup') return serveLookupApi(request, env);
    if (url.pathname.startsWith('/media/')) return ranged(request, env);
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    const md = MARKDOWN[path];
    if (md && wantsMarkdown(request.headers.get('accept'))) {
      const res = await env.ASSETS.fetch(new Request(new URL(md, url), request));
      const out = new Response(res.body, res);
      out.headers.set('Vary', 'Accept');
      return out;
    }
    const res = await env.ASSETS.fetch(request);
    if (!md || !(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
    const out = new Response(res.body, res);
    out.headers.append('Link', `<${md}>; rel="alternate"; type="text/markdown"`);
    out.headers.append('Link', '</llms.txt>; rel="describedby"; type="text/plain"');
    out.headers.set('Vary', 'Accept');
    return out;
  },
};
