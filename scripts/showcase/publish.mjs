// Writes the showcase page (site/scans/index.html) and its repo twin (docs/showcase/README.md) from the data in
// docs/showcase/: summary.json (aggregate.py), audit.json (the random precision sample) and examples.json (checked
// examples). Every number on both pages comes from those files.
// Usage: node scripts/showcase/publish.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(root, 'docs/showcase', f), 'utf8'));
const summary = read('summary.json');
const audit = read('audit.json');
const { examples } = read('examples.json');
const exAudit = read('examples-audit.json');

const AGENTS = new Set(['cline/cline', 'continuedev/continue', 'anomalyco/opencode', 'Kilo-Org/kilocode', 'google-gemini/gemini-cli', 'QwenLM/qwen-code', 'OpenHands/OpenHands', 'Aider-AI/aider', 'openai/codex', 'aaif-goose/goose']);
const repos = summary.repos.filter((r) => r.deps > 0);
const empty = summary.repos.filter((r) => r.deps === 0).map((r) => r.repo);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1)).toLocaleString('en-US');
const pct = (a, b) => Math.round((100 * a) / b);
function wilson(k, n, z = 1.96) {
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return `${Math.round(100 * (c - h))}–${Math.round(100 * (c + h))}%`;
}

const agents = repos.filter((r) => AGENTS.has(r.repo));
const apps = repos.filter((r) => !AGENTS.has(r.repo));
const issues = repos.map((r) => r.issues);
const med = median(issues);
const depShare = pct(sum(repos.map((r) => r.depsWithIssues)), sum(repos.map((r) => r.deps)));
const labels = audit.sample.map((s) => s.label);
const n = labels.length;
const open = labels.filter((l) => l.open === 'yes').length;
const versionOk = labels.filter((l) => l.version_ok === 'yes').length;
const strict = labels.filter((l) => l.open === 'yes' && l.version_ok === 'yes' && l.bug === 'yes').length;
const exPassed = exAudit.passed, exTotal = exAudit.candidates.length;
const short = (sha) => sha.slice(0, 7);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const byIssues = (a, b) => b.issues - a.issues;
const row = (r) => ({
  repo: r.repo, sha: r.sha, deps: r.deps, hit: r.depsWithIssues, issues: r.issues, runtime: r.runtimeIssues, armed: r.armed, work: r.workarounds,
});
const groups = [['Coding agents', agents.sort(byIssues).map(row)], ['Apps and libraries', apps.sort(byIssues).map(row)]];

const facts = [
  { num: fmt(med), acc: true, text: `Median open GitHub issues filed against the exact versions one of these ${repos.length} projects pins (range ${fmt(Math.min(...issues))}–${fmt(Math.max(...issues))}). ${fmt(median(repos.map((r) => r.runtimeIssues)))} of them in runtime dependencies.` },
  { num: `${depShare}%`, text: `Of all the dependency versions these projects pin, the share with at least one open issue naming that exact version.` },
  { num: `${versionOk}/${n}`, text: `Issues from a random sample that really were filed against the exact version (95% CI ${wilson(versionOk, n)}). Read the counts with that in mind.` },
];

// ---------- HTML ----------
const table = (rows) => `<div class="table-wrap"><table>
          <thead><tr><th>Project</th><th class="num">Open issues</th><th class="num">Runtime</th><th class="num">API-specific</th><th class="num">Workaround</th><th class="num">Deps</th><th class="num">With issues</th></tr></thead>
          <tbody>
${rows.map((r) => `            <tr><td><a href="https://github.com/${r.repo}/tree/${r.sha}">${esc(r.repo)}</a> <span class="label">${short(r.sha)}</span></td><td class="num"><strong>${r.issues}</strong></td><td class="num">${r.runtime}</td><td class="num">${r.armed}</td><td class="num">${r.work}</td><td class="num">${r.deps}</td><td class="num">${r.hit}</td></tr>`).join('\n')}
          </tbody>
        </table></div>`;

const exampleList = examples.map((e) => `          <li><strong><code>${esc(e.package)}@${esc(e.version)}</code></strong>, <a href="${esc(e.url)}">${esc(e.issue)}</a>. ${code(e.summary)} <span class="label">Pinned by ${e.pinnedBy.map(esc).join(', ')}</span></li>`).join('\n');

const html = `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open bugs in the exact versions popular projects pin: landmine scans</title>
<meta name="description" content="landmine scanned the lockfiles of ${repos.length} popular open-source projects, including ${agents.length} coding agents. The median project pins ${fmt(med)} open GitHub issues filed against its exact versions. A random audit confirmed ${versionOk} of ${n}.">
<link rel="canonical" href="https://landmine.tech/scans/">
<meta name="theme-color" content="#ffffff">
<meta property="og:type" content="article">
<meta property="og:site_name" content="landmine">
<meta property="og:url" content="https://landmine.tech/scans/">
<meta property="og:title" content="The median popular repo pins ${fmt(med)} open, version-specific bugs">
<meta property="og:description" content="Lockfile scans of ${repos.length} open-source projects, ${agents.length} of them coding agents. Every count, commit and audit label is public.">
<meta property="og:image" content="https://landmine.tech/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://landmine.tech/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/rethinksans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Dataset', name: 'landmine scans of popular open-source lockfiles', description: `Open GitHub issues filed against the exact dependency versions pinned by ${repos.length} open-source projects, with a random precision audit.`, url: 'https://landmine.tech/scans/', license: 'https://creativecommons.org/licenses/by/4.0/', isAccessibleForFree: true, creator: { '@type': 'Person', name: 'Devansh Ranjan', url: 'https://github.com/devanshranjan10' }, datePublished: summary.scanned, distribution: { '@type': 'DataDownload', contentUrl: 'https://github.com/devanshranjan10/landmines/tree/main/docs/showcase' } })}
</script>
<script defer src="/assets/site.js"></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<!-- @nav -->
<main id="main" class="rails">
  <section class="page-head">
    <canvas class="dots" data-field="edge" aria-hidden="true"></canvas>
    <div class="wrap">
      <span class="label">Scans · ${summary.scanned}</span>
      <h1>The bugs already sitting in <em>popular lockfiles</em>.</h1>
      <p class="lede">We ran <code>npx landmines scan</code> on ${repos.length} well-known open-source projects, ${agents.length} of them coding agents. Each one pins hundreds of dependency versions that have open, unfixed GitHub issues filed against that exact version. These are upstream bugs in libraries, not bugs in these projects, and a project may never touch the affected API.</p>
      <div class="row">
        <a class="btn dark" href="/docs/#quickstart">Scan your project</a>
        <a class="btn" href="https://github.com/devanshranjan10/landmines/tree/main/docs/showcase">Data and audit labels</a>
      </div>
    </div>
  </section>

  <div class="wrap facts">
${facts.map((f) => `    <div><div class="num${f.acc ? ' acc' : ''}">${f.num}</div><p>${esc(f.text)}</p></div>`).join('\n')}
  </div>

  <div class="wrap doc">
    <aside class="toc" aria-label="On this page">
      <h4>On this page</h4>
      <ol>
        <li><a href="#results">Every project</a></li>
        <li><a href="#examples">Checked examples</a></li>
        <li><a href="#audit">How many are real</a></li>
        <li><a href="#method">Method</a></li>
        <li><a href="#caveats">Caveats</a></li>
        <li><a href="#yours">Scan yours</a></li>
      </ol>
    </aside>
    <div class="prose">
      <section id="results">
        <h2>Every project</h2>
        <p>Scanned on ${summary.scanned} at the commit shown. <strong>Open issues</strong>: distinct open GitHub issues that name the exact version the lockfile pins. <strong>Runtime</strong>: in dependencies the lockfile doesn't mark as dev-only. <strong>API-specific</strong>: tied to named functions or options, which the pre-edit hook watches. <strong>Workaround</strong>: the thread has one.</p>
${groups.map(([title, rows]) => `        <h3>${title} (median ${fmt(median(rows.map((r) => r.issues)))})</h3>\n        ${table(rows)}`).join('\n')}
        <p>Across all ${repos.length} projects: ${fmt(summary.distinctIssues)} distinct issues, ${fmt(summary.distinctArmed)} of them API-specific. ${empty.map(esc).join(', ')} commits no lockfile, so there was nothing to scan.</p>
      </section>

      <section id="examples">
        <h2>Checked examples</h2>
        <p>The ${examples.length} below were each read in full and kept only if the issue is open, is a bug report, was confirmed on the exact version pinned, and is in the package named. They come from the three most-discussed API-specific runtime issues per project: ${exPassed} of those ${exTotal} candidates passed. Heavily discussed issues fail more often than average, because long threads collect "fixed in X" and other versions.</p>
        <ul class="examples">
${exampleList}
        </ul>
      </section>

      <section id="audit">
        <h2>How many are real</h2>
        <p>We drew ${n} issues at random (seed ${audit.seed}) from the ${fmt(audit.population)} distinct API-specific issues and had each one read in full by an agent that didn't build the tool.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Check</th><th class="num">Passed</th><th class="num">95% CI</th></tr></thead>
          <tbody>
            <tr><td>Still open</td><td class="num">${open}/${n}</td><td class="num">${wilson(open, n)}</td></tr>
            <tr class="hl"><td><strong>Reporter or a confirming commenter ran the exact version</strong></td><td class="num"><strong>${versionOk}/${n}</strong></td><td class="num">${wilson(versionOk, n)}</td></tr>
            <tr><td>…and it's clearly a bug report (not a question, usage error or docs)</td><td class="num">${strict}/${n}</td><td class="num">${wilson(strict, n)}</td></tr>
          </tbody>
        </table></div>
        <ul>
          <li><strong>Where the version was wrong.</strong> Four were a sibling package from the same repository (an <code>@xterm/xterm</code> bug counted against <code>@xterm/headless</code>). Two took the version of another package in a dependency list. Two read "6.0.3 is fine" as the affected version. One was a semver range, not an installed version, and one was unclear.</li>
          <li><strong>Consistent with the earlier measurement.</strong> <a href="https://github.com/devanshranjan10/landmines/blob/main/docs/ACCURACY.md">ACCURACY.md</a> found 78% and 82.5% on two held-out samples.</li>
          <li><strong>One labeller per issue, an AI agent.</strong> Every label, with the quote that decided it, is in <a href="https://github.com/devanshranjan10/landmines/blob/main/docs/showcase/audit.json">audit.json</a>.</li>
        </ul>
      </section>

      <section id="method">
        <h2>Method</h2>
        <ul>
          <li><strong>Projects.</strong> ${agents.length} open-source coding agents and ${apps.length + empty.length} widely used apps and libraries, chosen before scanning.</li>
          <li><strong>Lockfiles.</strong> Every <code>pnpm-lock.yaml</code>, <code>yarn.lock</code>, <code>bun.lock</code>, <code>package-lock.json</code>, <code>uv.lock</code>, <code>poetry.lock</code>, <code>Pipfile.lock</code> or <code>requirements*.txt</code> at most three folders deep, outside tests, fixtures, examples and docs. Folders that don't ship (evals, sandboxes, scratch artifacts, integration-test projects) were dropped afterwards and are listed in the data.</li>
          <li><strong>Counting.</strong> Exactly what <code>landmine scan</code> prints: weak mentions and non-bugs left out, and each issue counted once per project even when several packages or lockfiles pin it.</li>
          <li><strong>Reproduce.</strong> <code>scripts/showcase/run.sh</code>, <code>aggregate.py</code> and <code>sample.py</code> in the repository, with landmine 0.2.1. Issues get opened, closed and edited, so a rerun on another day will differ.</li>
        </ul>
      </section>

      <section id="caveats">
        <h2>Caveats</h2>
        <ul>
          <li><strong>An open issue in a dependency is not a bug in the project.</strong> The project may never call the affected API, may already work around it, or may not meet the conditions.</li>
          <li><strong>Dev tooling is included.</strong> TypeScript, Prettier and test runners carry many issues. The runtime column leaves dev-only dependencies out.</li>
          <li><strong>Precision is about ${pct(versionOk, n)}%</strong>, measured above; the raw counts are what the tool reports, not audited totals.</li>
          <li><strong>Recall is not measured.</strong> Bugs whose reports don't name a version are missed entirely.</li>
        </ul>
      </section>

      <section id="yours">
        <h2>Scan yours</h2>
        <div class="code"><pre>npx landmines scan                 <span class="c"># what's in your lockfile</span>
npx landmines install --rules      <span class="c"># put it where your agent reads it</span>
npx landmines share                <span class="c"># one postable line and a README badge</span></pre></div>
      </section>
    </div>
  </div>
</main>
<!-- @footer -->
</body>
</html>
`;
mkdirSync(join(root, 'site/scans'), { recursive: true });
writeFileSync(join(root, 'site/scans/index.html'), html);

// ---------- Markdown (the repo copy) ----------
const mdTable = (rows) => ['| Project | Commit | Open issues | Runtime | API-specific | Workaround | Deps | With issues |', '|---|---|---:|---:|---:|---:|---:|---:|',
  ...rows.map((r) => `| [${r.repo}](https://github.com/${r.repo}/tree/${r.sha}) | \`${short(r.sha)}\` | **${r.issues}** | ${r.runtime} | ${r.armed} | ${r.work} | ${r.deps} | ${r.hit} |`)].join('\n');
const md = `# Scans of popular lockfiles (${summary.scanned})

Generated by \`node scripts/showcase/publish.mjs\` from the JSON files in this folder; the same page is at
https://landmine.tech/scans/.

landmine scanned the lockfiles of ${repos.length} well-known open-source projects, ${agents.length} of them coding agents.
These are upstream bugs in libraries, not bugs in these projects, and a project may never touch the affected API.

- **${fmt(med)}**: median open GitHub issues filed against the exact versions a project pins (range ${fmt(Math.min(...issues))}–${fmt(Math.max(...issues))}; ${fmt(median(repos.map((r) => r.runtimeIssues)))} in runtime dependencies).
- **${depShare}%** of all pinned dependency versions have at least one open issue naming that exact version.
- **${versionOk}/${n}** issues in a random sample really were filed against the exact version (95% CI ${wilson(versionOk, n)}); ${strict}/${n} were also clearly bug reports (${wilson(strict, n)}).
- ${fmt(summary.distinctIssues)} distinct issues across all projects, ${fmt(summary.distinctArmed)} of them tied to specific APIs.

## Every project

**Open issues**: distinct open issues naming the exact pinned version. **Runtime**: in dependencies not marked
dev-only. **API-specific**: tied to named functions or options (what the pre-edit hook watches). **Workaround**: the
thread has one.

${groups.map(([title, rows]) => `### ${title} (median ${fmt(median(rows.map((r) => r.issues)))})\n\n${mdTable(rows)}`).join('\n\n')}

${empty.join(', ')} commits no lockfile, so there was nothing to scan.

## Checked examples

Each was read in full and kept only if it is open, a bug report, confirmed on the exact pinned version, and in the
package named. Candidates were the three most-discussed API-specific runtime issues per project; ${exPassed} of ${exTotal}
passed (\`examples-audit.json\`), and these are a de-duplicated subset.

${examples.map((e) => `- **\`${e.package}@${e.version}\`**, [${e.issue}](${e.url}). ${e.summary} Pinned by ${e.pinnedBy.join(', ')}.`).join('\n')}

## How many are real

${n} issues drawn at random (seed ${audit.seed}) from the ${fmt(audit.population)} distinct API-specific issues, each read in
full by an agent that didn't build the tool. Labels and deciding quotes: \`audit.json\`.

| Check | Passed | 95% CI |
|---|---:|---:|
| Still open | ${open}/${n} | ${wilson(open, n)} |
| Reporter or a confirming commenter ran the exact version | **${versionOk}/${n}** | ${wilson(versionOk, n)} |
| …and clearly a bug report (not a question, usage error or docs) | ${strict}/${n} | ${wilson(strict, n)} |

Where the version was wrong: four were a sibling package from the same repository (an \`@xterm/xterm\` bug counted
against \`@xterm/headless\`); two took another package's version from a dependency list; two read "6.0.3 is fine" as
the affected version; one was a semver range; one was unclear. This matches \`docs/ACCURACY.md\` (78% and 82.5% on held-out samples).
One labeller per issue, an AI agent.

## Method

- **Lockfiles**: every pnpm, yarn, bun, npm, uv, poetry, Pipfile or requirements file at most three folders deep,
  outside tests, fixtures, examples and docs; folders that don't ship (evals, sandboxes, scratch artifacts,
  integration-test projects) dropped afterwards and listed per project in \`summary.json\` (\`skippedDirs\`).
- **Counting**: what \`landmine scan\` prints. Weak mentions and non-bugs left out; each issue once per project.
- **Reproduce**: \`SHOWCASE_DIR=/tmp/lm-showcase scripts/showcase/run.sh owner/repo … > run.log\`, then
  \`aggregate.py\` and \`sample.py\`. Issues change daily, so reruns will differ.

## Caveats

- An open issue in a dependency is not a bug in the project.
- Dev tooling (TypeScript, Prettier, test runners) is included; the runtime column leaves it out.
- Precision is about ${pct(versionOk, n)}%; the counts are what the tool reports, not audited totals.
- Recall is not measured.
`;
writeFileSync(join(root, 'docs/showcase/README.md'), md);
console.log(`wrote site/scans/index.html and docs/showcase/README.md (${repos.length} projects, median ${med}, audit ${versionOk}/${n})`);
