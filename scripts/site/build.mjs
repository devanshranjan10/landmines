// Builds landmine.tech: copies site/ to .site-dist/, filling in the shared nav and footer partials,
// and writes the agent-readable copies: /<page>.md for every page, /llms-full.txt, and FAQPage JSON-LD.
// Usage: node scripts/site/build.mjs
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const ORIGIN = 'https://landmine.tech';
const UPDATED = new Date().toISOString().slice(0, 10);
const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'site');
const out = join(root, '.site-dist');
const nav = readFileSync(join(src, 'partials/nav.html'), 'utf8');
const footer = readFileSync(join(src, 'partials/footer.html'), 'utf8');

// Cache-bust the stylesheet and script: pages link them as /assets/x?v=<content hash>.
const version = (file) => createHash('sha256').update(readFileSync(join(src, file))).digest('hex').slice(0, 10);
const assets = { '/assets/site.css': version('assets/site.css'), '/assets/site.js': version('assets/site.js') };

// Pages whose markdown twin is generated from the HTML. The home page's twin (site/index.md) is hand-written,
// because the page itself is mostly visual.
const GENERATED_MD = { '/docs/': 'docs.md', '/benchmark/': 'benchmark.md', '/faq/': 'faq.md' };
const MD_FOR = { '/': 'index.md', ...GENERATED_MD };

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
td.use(gfm);
const hasClass = (node, c) => (node.getAttribute?.('class') ?? '').split(/\s+/).includes(c);
td.remove(['script', 'style', 'noscript', 'button', 'svg', 'aside']);
td.addRule('drop-ui', { filter: (n) => hasClass(n, 'tip') || hasClass(n, 'skip'), replacement: () => '' });
td.addRule('pre', { filter: 'pre', replacement: (_c, n) => `\n\n\`\`\`\n${n.textContent.replace(/\n+$/, '')}\n\`\`\`\n\n` });
td.addRule('chart', {
  // Interactive bar charts become a table built from their data.
  filter: (n) => n.nodeName === 'DIV' && hasClass(n, 'chart') && n.getAttribute('data-rows'),
  replacement: (_c, n) => {
    const rows = JSON.parse(n.getAttribute('data-rows'));
    const max = n.getAttribute('data-max');
    const title = n.querySelector('h3')?.textContent ?? 'Results';
    const desc = n.querySelector('.desc')?.textContent ?? '';
    const lines = rows.map((r) => `| ${r.name} | ${r.passed}/${max} | ${r.note || ''} |`);
    return `\n\n**${title}.** ${desc}\n\n| Setup | Passed | Paired vs landmine |\n|---|---|---|\n${lines.join('\n')}\n\n`;
  },
});
td.addRule('facts', {
  // Big-number tiles: "**66**: Tasks, each validated…"
  filter: (n) => n.nodeName === 'DIV' && n.parentNode && hasClass(n.parentNode, 'facts'),
  replacement: (_c, n) => `\n- **${n.querySelector('.num')?.textContent.trim()}**: ${n.querySelector('p')?.textContent.trim()}\n`,
});
td.addRule('absolute-links', {
  filter: (n) => n.nodeName === 'A' && n.getAttribute('href'),
  replacement: (content, n) => {
    let href = n.getAttribute('href');
    if (href.startsWith('/')) href = ORIGIN + href;
    else if (href.startsWith('#')) return content;
    return content.trim() ? `[${content}](${href})` : '';
  },
});

const textOf = (html) => html.replace(/<\/(p|div|h\d|li|pre)>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const meta = (html, name) => html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] ?? '';

function toMarkdown(html, path) {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '';
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'landmine';
  const body = td.turndown(main).replace(/\n{3,}/g, '\n\n').trim();
  return `---\ntitle: "${title.replace(/"/g, "'")}"\nurl: ${ORIGIN}${path}\nupdated: ${UPDATED}\n---\n\n> ${meta(html, 'description')}\n> Source: ${ORIGIN}${path} · Repository: https://github.com/devanshranjan10/landmines\n\n${body}\n`;
}

function faqJsonLd(html) {
  const items = [...html.matchAll(/<section class="qa" id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>\s*<div class="a">([\s\S]*?)<\/div>\s*<\/section>/g)];
  if (!items.length) return '';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `${ORIGIN}/faq/`,
    mainEntity: items.map(([, id, q, a]) => ({
      '@type': 'Question',
      '@id': `${ORIGIN}/faq/#${id}`,
      name: textOf(q),
      acceptedAnswer: { '@type': 'Answer', text: textOf(a.replace(/<div class="code">[\s\S]*?<\/div>/, ' (BibTeX on the page) ')) },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(data)}\n</script>\n`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const markdown = {};

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
    for (const [asset, v] of Object.entries(assets)) html = html.replaceAll(`"${asset}"`, `"${asset}?v=${v}"`);
    const alt = [`<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">`];
    if (MD_FOR[path]) alt.unshift(`<link rel="alternate" type="text/markdown" title="This page as Markdown" href="/${MD_FOR[path]}">`);
    html = html.replace('<link rel="stylesheet"', `${alt.join('\n')}\n${faqJsonLd(html)}<link rel="stylesheet"`);
    if (html.includes('<!-- @')) throw new Error(`unfilled partial in ${rel}`);
    writeFileSync(to, html);
    if (GENERATED_MD[path]) markdown[GENERATED_MD[path]] = toMarkdown(html, path);
  }
}
walk(src);

for (const [file, md] of Object.entries(markdown)) writeFileSync(join(out, file), md);
markdown['index.md'] = readFileSync(join(src, 'index.md'), 'utf8');
const order = ['index.md', 'docs.md', 'faq.md', 'benchmark.md'];
const full = order.map((f) => `<!-- ${ORIGIN}/${f} -->\n\n${markdown[f].trim()}\n`).join('\n\n---\n\n');
writeFileSync(join(out, 'llms-full.txt'), `# landmine: everything on landmine.tech, as Markdown (generated ${UPDATED})\n\n${full}`);
console.log(`built ${relative(root, out)}/ (+ ${Object.keys(GENERATED_MD).length} generated .md, llms-full.txt)`);
