// Builds landmine.tech: copies site/ to .site-dist/, filling in the shared nav and footer partials.
// Usage: node scripts/site/build.mjs
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'site');
const out = join(root, '.site-dist');
const nav = readFileSync(join(src, 'partials/nav.html'), 'utf8');
const footer = readFileSync(join(src, 'partials/footer.html'), 'utf8');

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
    const html = readFileSync(from, 'utf8').replace('<!-- @nav -->', pageNav).replace('<!-- @footer -->', footer);
    if (html.includes('<!-- @')) throw new Error(`unfilled partial in ${rel}`);
    writeFileSync(to, html);
  }
}
walk(src);
console.log(`built ${relative(root, out)}/`);
