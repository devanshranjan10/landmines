// landmine.tech: small, dependency-free page behaviour. Everything degrades to static content without JS.
document.documentElement.classList.remove('no-js');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Copy buttons: <button data-copy="text"> or a .code block's button.
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';
async function copy(text, btn, label) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  btn.dataset.done = '';
  const prev = btn.innerHTML;
  btn.innerHTML = label ? 'Copied' : DONE_ICON;
  setTimeout(() => { delete btn.dataset.done; btn.innerHTML = prev; }, 1600);
}
for (const btn of document.querySelectorAll('[data-copy]')) {
  if (!btn.innerHTML.trim()) btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', () => copy(btn.dataset.copy, btn));
}
for (const block of document.querySelectorAll('.code')) {
  const btn = document.createElement('button');
  btn.className = 'copy'; btn.type = 'button'; btn.textContent = 'Copy';
  btn.addEventListener('click', () => {
    const text = [...block.querySelector('pre').childNodes]
      .filter((n) => !(n.nodeType === 1 && n.classList.contains('c')))
      .map((n) => n.textContent).join('')
      .split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).join('\n');
    copy(text, btn, true);
  });
  block.append(btn);
}

// Mobile menu.
const nav = document.querySelector('.nav');
nav?.querySelector('.menu-btn')?.addEventListener('click', (e) => {
  const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
// Hairline under the nav once the page has scrolled.
const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// GitHub star count (public API, cached for the tab; silently absent on failure).
const starEl = document.querySelector('[data-stars]');
if (starEl) {
  const show = (n) => { if (Number.isFinite(n)) { starEl.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); starEl.hidden = false; } };
  const cached = sessionStorage.getItem('lm-stars');
  if (cached) show(Number(cached));
  else fetch('https://api.github.com/repos/devanshranjan10/landmines', { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && typeof j.stargazers_count === 'number') { sessionStorage.setItem('lm-stars', j.stargazers_count); show(j.stargazers_count); } })
    .catch(() => {});
}

// Reveal on scroll.
const io = 'IntersectionObserver' in window && !reduced
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' })
  : null;
for (const el of document.querySelectorAll('.reveal')) {
  if (io) io.observe(el);
  else el.classList.add('in');
}

// Hero session replay: steps appear in order, once, when the window scrolls into view.
const session = document.querySelector('.session[data-play]');
if (session && !reduced && 'IntersectionObserver' in window) {
  const steps = [...session.querySelectorAll('.step')];
  const hits = document.querySelectorAll('[data-hit]');
  session.classList.add('play');
  const delays = steps.map((s) => Number(s.dataset.delay || 900));
  const run = () => {
    let t = 250;
    steps.forEach((s, i) => {
      t += i ? delays[i] : 0;
      setTimeout(() => {
        s.classList.add('on');
        if (s.dataset.flag) for (const h of hits) h.classList.toggle('hit', h.dataset.hit === s.dataset.flag);
      }, t);
    });
  };
  // Start when the top of the session is a fifth of the way up the viewport; tall on phones, so no ratio threshold.
  const sio = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { sio.disconnect(); run(); }
  }, { rootMargin: '0px 0px -20% 0px' });
  sio.observe(session);
}

// Bar charts: <div class="chart" data-max="42" data-rows='[{"name","passed","note","hl"}]'>.
for (const chart of document.querySelectorAll('.chart[data-rows]')) {
  const rows = JSON.parse(chart.dataset.rows);
  const max = Number(chart.dataset.max);
  const bars = chart.querySelector('.bars');
  const tip = chart.querySelector('.tip');
  for (const d of rows) {
    const row = document.createElement('div');
    row.className = 'bar-row' + (d.hl ? ' hl' : '');
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', `${d.name}: ${d.passed} of ${max} passed. ${d.note}`);
    row.innerHTML = '<span class="name"></span><span class="track"><span class="fill"></span></span><span class="val"></span>';
    row.querySelector('.name').textContent = d.name;
    row.querySelector('.val').textContent = `${d.passed}/${max}`;
    const fill = row.querySelector('.fill');
    fill.dataset.w = `${(d.passed / max) * 100}%`;
    const show = (x, y) => {
      tip.innerHTML = '<b></b><span></span><span></span>';
      tip.children[0].textContent = d.name;
      tip.children[1].textContent = `${d.passed} of ${max} runs passed (${Math.round((d.passed / max) * 100)}%)`;
      tip.children[2].textContent = d.note;
      tip.style.left = Math.max(8, Math.min(x + 14, chart.clientWidth - 296)) + 'px';
      tip.style.top = y + 16 + 'px';
      tip.style.opacity = 1;
    };
    row.addEventListener('mousemove', (e) => { const r = chart.getBoundingClientRect(); show(e.clientX - r.left, e.clientY - r.top); });
    row.addEventListener('focus', () => show(row.offsetLeft + 220, row.offsetTop + row.offsetHeight - 6));
    row.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
    row.addEventListener('blur', () => { tip.style.opacity = 0; });
    bars.append(row);
  }
  const grow = () => { for (const f of chart.querySelectorAll('.fill')) f.style.width = f.dataset.w; };
  if (reduced || !('IntersectionObserver' in window)) grow();
  else {
    const cio = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { cio.disconnect(); grow(); } }, { threshold: 0.3 });
    cio.observe(chart);
  }
}

// Docs table of contents: highlight the section in view.
const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const tio = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      for (const a of tocLinks) a.classList.toggle('active', a === byId.get(e.target.id));
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const id of byId.keys()) { const s = document.getElementById(id); if (s) tio.observe(s); }
}
