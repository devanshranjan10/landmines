// Builds landmine.tech: copies site/ to .site-dist/, filling in the shared nav and footer partials.
// Usage: node scripts/site/build.mjs
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'site');
const out = join(root, '.site-dist');
const nav = readFileSync(join(src, 'partials/nav.html'), 'utf8');
const footer = readFileSync(join(src, 'partials/footer.html'), 'utf8');
// Cache-bust the stylesheet and script: pages link them as /assets/x?v=<content hash>.
const version = (file) => createHash('sha256').update(readFileSync(join(src, file))).digest('hex').slice(0, 10);
const assets = { '/assets/site.css': version('assets/site.css'), '/assets/site.js': version('assets/site.js') };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const from = join(dir, name);
    const rel = relative(src, from);
    if (rel === 'partials' || name === '.DS_Store') continue;
    if (statSync(from).isDirectory()) { walk(from); continue; }
    const to = join(out, rel);
    mkdirSync(join(to, '..'), { recursive: true });
    if (!name.endsWith('.html')) { cpSync(from, to); continue; }
    // "/docs/index.html" -> "/docs/": mark that nav link as the current page.
    const path = '/' + rel.replace(/index\.html$/, '').replace(/\\/g, '/');
    const pageNav = path === '/' ? nav : nav.replace(`<a href="${path}">`, `<a href="${path}" aria-current="page">`);
    let html = readFileSync(from, 'utf8').replace('<!-- @nav -->', pageNav).replace('<!-- @footer -->', footer);
    for (const [path, v] of Object.entries(assets)) html = html.replaceAll(`"${path}"`, `"${path}?v=${v}"`);
    if (html.includes('<!-- @')) throw new Error(`unfilled partial in ${rel}`);
    writeFileSync(to, html);
  }
}
walk(src);
console.log(`built ${relative(root, out)}/`);
