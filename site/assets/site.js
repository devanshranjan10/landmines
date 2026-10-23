// landmine.tech: small, dependency-free page behaviour. Everything degrades to static content without JS.
// The visuals are a dot-matrix "minefield" drawn on <canvas>: hollow and filled dots, a few of which are mines that ping.
document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const css = getComputedStyle(document.documentElement);
const ACCENT = css.getPropertyValue('--accent').trim() || '#ff5a1f';
const DOT = css.getPropertyValue('--dot').trim() || '#ffcbb8';
const DOT2 = css.getPropertyValue('--dot-2').trim() || '#ffe2d7';
const INK = '#09090b';

/* ---------------------------------------------------------------- canvas helpers */

/** Size a canvas to its box at device resolution; returns the 2D context in CSS pixels. */
function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function dot(ctx, x, y, r, fill, ring) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (ring) {
    ctx.lineWidth = Math.max(1, r * 0.42);
    ctx.strokeStyle = ring;
    ctx.stroke();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/** Run `frame(t)` only while the element is on screen and the tab is visible; once if motion is reduced. */
function animate(el, frame, fps = 30) {
  if (reduced) { frame(0); return; }
  let on = false;
  let raf = 0;
  let last = 0;
  const t0 = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / fps) return;
    last = now;
    frame((now - t0) / 1000);
  };
  const set = (v) => {
    if (v === on) return;
    on = v;
    if (on && !document.hidden) raf = requestAnimationFrame(loop);
    else cancelAnimationFrame(raf);
  };
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => set(es.some((e) => e.isIntersecting))).observe(el);
  else set(true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else if (on) raf = requestAnimationFrame(loop); });
  frame(0);
}

// Smooth value noise, so dot clusters drift as soft diagonal streaks.
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/* ---------------------------------------------------------------- the minefield background */

/**
 * <canvas class="dots" data-field="hero|edge|soft|night">. Dots appear where drifting noise is high and fade where
 * the copy sits; the cursor sweeps a clearing that reveals more of them; now and then a dot is a mine and pings.
 */
function minefield(canvas) {
  const kind = canvas.dataset.field || 'hero';
  const host = canvas.parentElement;
  const night = kind === 'night';
  let mouse = null;
  const pings = [];
  let nextPing = 0.6;
  if (!coarse) {
    host.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    host.addEventListener('pointerleave', () => { mouse = null; });
  }
  const filled = night ? 'rgba(255,255,255,.16)' : DOT;
  const faint = night ? 'rgba(255,255,255,.07)' : DOT2;
  const strong = night ? 'rgba(255,90,31,.85)' : ACCENT;
  animate(host, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const s = w < 640 ? 22 : 26;
    const r = s * 0.19;
    const cols = Math.ceil(w / s) + 1, rows = Math.ceil(h / s) + 1;
    const ox = (w - (cols - 1) * s) / 2, oy = 6;
    const visible = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = ox + i * s, y = oy + j * s;
        // Where the copy is, fewer dots: the hero keeps a calm centre column, other fields thin out evenly.
        const nx = Math.abs(x / w - 0.5) * 2;
        let mask;
        if (kind === 'hero') mask = (w < 640 ? smooth(0.6, 1.0, nx) : smooth(0.34, 0.86, nx)) * (1 - smooth(0.92, 1.0, y / h) * 0.6);
        else if (kind === 'edge' || kind === 'night') mask = smooth(w < 640 ? 0.7 : 0.66, 1.0, nx);
        else mask = 0.75;
        let v = noise(i * 0.16 + t * 0.12, j * 0.16 - i * 0.05 - t * 0.09) * mask;
        if (mouse) {
          const d = Math.hypot(mouse.x - x, mouse.y - y);
          if (d < 150) v += (1 - d / 150) * 0.55;
        }
        if (v < 0.4) continue;
        const tw = hash(i, j);
        const flick = Math.sin(t * (0.6 + tw * 1.4) + tw * 40) * 0.08;
        const val = v + flick;
        if (val > 0.66) dot(ctx, x, y, r, tw > 0.82 ? strong : filled);
        else if (val > 0.5) dot(ctx, x, y, r * 0.92, null, night ? 'rgba(255,255,255,.2)' : DOT);
        else dot(ctx, x, y, r * 0.8, faint);
        if (val > 0.5) visible.push([x, y]);
      }
    }
    // Mines: a dot lights up and sends out a ring.
    if (!reduced && t > nextPing && visible.length) {
      const [x, y] = visible[Math.floor(Math.random() * visible.length)];
      pings.push({ x, y, t0: t });
      nextPing = t + 0.7 + Math.random() * 1.4;
    }
    for (let k = pings.length - 1; k >= 0; k--) {
      const p = pings[k];
      const a = (t - p.t0) / 1.6;
      if (a > 1) { pings.splice(k, 1); continue; }
      dot(ctx, p.x, p.y, r * 1.15, strong);
      ctx.globalAlpha = 1 - a;
      dot(ctx, p.x, p.y, r + a * s * 1.6, null, strong);
      ctx.globalAlpha = 1;
    }
  });
}

/* ---------------------------------------------------------------- dot text (wordmark, loader, labels) */

/** Rasterise `text` and sample it on a grid: one dot per cell, filled where the glyph is solid, hollow at its edges. */
function textCells(text, cols, font = '700 100px "Rethink Sans", system-ui, sans-serif') {
  const k = 6;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const m = probe.measureText(text);
  const aspect = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / m.width;
  const rows = Math.max(3, Math.round(cols * aspect));
  const c = document.createElement('canvas');
  c.width = cols * k;
  c.height = rows * k;
  const g = c.getContext('2d', { willReadFrequently: true });
  const scale = (cols * k) / m.width;
  g.scale(scale, scale);
  g.font = font;
  g.fillStyle = '#000';
  g.fillText(text, -m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) sum += data[((j * k + y) * c.width + i * k + x) * 4 + 3];
      const cov = sum / (k * k * 255);
      if (cov > 0.12) cells.push({ i, j, cov });
    }
  }
  return { cells, cols, rows };
}

/** The footer's giant dotted wordmark: dots near the cursor turn hazard orange and lean away from it. */
function wordmark(canvas) {
  const host = canvas.parentElement.parentElement;
  let mouse = null;
  let grid = null;
  let gridW = 0;
  if (!coarse) {
    host.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    host.addEventListener('pointerleave', () => { mouse = null; });
  }
  const pings = [];
  let nextPing = 0.4;
  animate(canvas, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const cols = w < 640 ? 70 : 118;
    if (!grid || gridW !== w) { grid = textCells('landmine', cols); gridW = w; }
    const s = w / (grid.cols + 2);
    const r = s * 0.36;
    const top = h - grid.rows * s - s * 0.6;
    for (const c of grid.cells) {
      let x = (c.i + 1.5) * s, y = top + c.j * s;
      let hot = 0;
      if (mouse) {
        const d = Math.hypot(mouse.x - x, mouse.y - y);
        if (d < 130) { hot = 1 - d / 130; x += ((x - mouse.x) / (d || 1)) * hot * 7; y += ((y - mouse.y) / (d || 1)) * hot * 7; }
      }
      const tw = hash(c.i, c.j);
      const shimmer = 0.55 + 0.45 * Math.sin(t * 1.3 + tw * 30 + c.i * 0.08);
      if (hot > 0.15) dot(ctx, x, y, r * (1 + hot * 0.25), ACCENT);
      else if (c.cov > 0.6) dot(ctx, x, y, r, `rgba(255,255,255,${0.55 + shimmer * 0.4})`);
      else dot(ctx, x, y, r * 0.9, null, `rgba(255,255,255,${0.28 + shimmer * 0.25})`);
    }
    if (!reduced && t > nextPing && grid.cells.length) {
      const c = grid.cells[Math.floor(Math.random() * grid.cells.length)];
      pings.push({ x: (c.i + 1.5) * s, y: top + c.j * s, t0: t });
      nextPing = t + 0.5 + Math.random();
    }
    for (let k = pings.length - 1; k >= 0; k--) {
      const p = pings[k];
      const a = (t - p.t0) / 1.4;
      if (a > 1) { pings.splice(k, 1); continue; }
      dot(ctx, p.x, p.y, r * 1.1, ACCENT);
      ctx.globalAlpha = 1 - a;
      dot(ctx, p.x, p.y, r + a * s * 2.2, null, ACCENT);
      ctx.globalAlpha = 1;
    }
  }, 40);
}

/** A row of dots that ripple: the loading indicator. */
function loader(canvas) {
  let stop = false;
  const start = performance.now();
  const draw = () => {
    if (stop) return;
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const t = (performance.now() - start) / 1000;
    const n = 7;
    const s = w / n;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, Math.sin(t * 5 - i * 0.7));
      dot(ctx, s * (i + 0.5), h / 2 - a * 4, s * 0.22, a > 0.4 ? ACCENT : DOT);
    }
    requestAnimationFrame(draw);
  };
  draw();
  return () => { stop = true; };
}

/* ---------------------------------------------------------------- dotted illustrations */

const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';
function dotLine(ctx, x1, y1, x2, y2, gap, r, color, ring) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(1, Math.round(len / gap));
  for (let i = 0; i <= n; i++) dot(ctx, x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, r, color, ring);
}
function dotRect(ctx, x, y, w, h, gap, r, color, ring) {
  dotLine(ctx, x, y, x + w, y, gap, r, color, ring);
  dotLine(ctx, x, y + h, x + w, y + h, gap, r, color, ring);
  dotLine(ctx, x, y, x, y + h, gap, r, color, ring);
  dotLine(ctx, x + w, y, x + w, y + h, gap, r, color, ring);
}
function dotBlock(ctx, x, y, w, h, gap, r, color, ring) {
  for (let yy = y; yy <= y + h + 0.1; yy += gap) for (let xx = x; xx <= x + w + 0.1; xx += gap) dot(ctx, xx, yy, r, color, ring);
}
function label(ctx, x, y, text, size, color, weight = 400) {
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

const SCENES = {
  // A lockfile scanned row by row; one pinned version lights up with its open issue.
  scan(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.3;
    const rows = ['zod           3.23.8', 'vite          8.0.16', 'drizzle-orm   0.36.0', 'date-fns      3.6.0', 'pydantic      2.9.2'];
    const bx = w * 0.1, bw = w * 0.8, rh = h * 0.13, gap = h * 0.035;
    const y0 = (h - rows.length * rh - (rows.length - 1) * gap) / 2;
    const scanY = y0 + ((t * 0.35) % 1) * (rows.length * (rh + gap));
    rows.forEach((name, i) => {
      const y = y0 + i * (rh + gap);
      const mine = i === 2;
      const lit = mine && (reduced || Math.floor(t * 0.35) % 2 === 0 || scanY > y);
      dotRect(ctx, bx, y, bw, rh, g, r, lit ? ACCENT : null, lit ? null : DOT);
      dotBlock(ctx, bx + g * 1.6, y + rh / 2 - g, g * 2, g * 2, g, r, lit ? ACCENT : DOT);
      label(ctx, bx + g * 6, y + rh / 2, name, Math.max(9, h * 0.042), lit ? INK : '#71717a', lit ? 600 : 400);
      if (lit) label(ctx, bx + bw - g * 12.5, y + rh / 2, '#3402 open', Math.max(8, h * 0.036), '#c93c0c', 500);
    });
    if (!reduced) {
      ctx.globalAlpha = 0.5;
      dotLine(ctx, bx - g * 2, Math.min(scanY, y0 + rows.length * (rh + gap)), bx + bw + g * 2, Math.min(scanY, y0 + rows.length * (rh + gap)), g * 1.4, r * 0.7, ACCENT);
      ctx.globalAlpha = 1;
    }
  },
  // The known-bugs section written into CLAUDE.md.
  rules(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.3;
    const x = w * 0.14, y = h * 0.1, pw = w * 0.72, ph = h * 0.8;
    dotRect(ctx, x, y, pw, ph, g, r, null, DOT);
    dotBlock(ctx, x + pw - g * 4, y + g * 1.5, g * 2, g * 1, g, r * 0.9, DOT);
    label(ctx, x + g * 2.4, y + g * 2.2, 'CLAUDE.md', Math.max(9, h * 0.04), '#71717a');
    label(ctx, x + g * 2.4, y + h * 0.2, '## Known open bugs', Math.max(10, h * 0.05), INK, 600);
    const items = [['drizzle-orm@0.36.0', '$count'], ['date-fns@3.6.0', 'subDays'], ['pydantic@2.9.2', 'model_dump']];
    items.forEach(([pkg, api], i) => {
      const yy = y + h * 0.33 + i * h * 0.15;
      const on = reduced || Math.floor(t * 0.8) % 3 === i;
      dot(ctx, x + g * 2.8, yy, r * 1.4, on ? ACCENT : DOT);
      label(ctx, x + g * 4.6, yy - h * 0.025, pkg, Math.max(8.5, h * 0.038), '#c93c0c', 600);
      label(ctx, x + g * 4.6, yy + h * 0.035, `\`${api}\` · workaround`, Math.max(8, h * 0.034), '#71717a');
    });
  },
  // An edit paused once, then re-applied with the workaround.
  hook(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.3;
    const phase = reduced ? 1 : (t * 0.4) % 2;
    const bx = w * 0.1, bw = w * 0.8, bh = h * 0.28;
    const y1 = h * 0.12, y2 = h * 0.6;
    dotRect(ctx, bx, y1, bw, bh, g, r, ACCENT);
    label(ctx, bx + g * 2, y1 + bh * 0.3, 'Edit src/db.ts', Math.max(9, h * 0.042), INK, 600);
    label(ctx, bx + bw - g * 10, y1 + bh * 0.3, '✕ paused', Math.max(9, h * 0.04), '#c93c0c', 600);
    label(ctx, bx + g * 2, y1 + bh * 0.68, '- await db.$client.end()', Math.max(8.5, h * 0.038), '#a1a1aa');
    dotLine(ctx, bx + g * 2, y1 + bh * 0.68, bx + bw * 0.62, y1 + bh * 0.68, g * 0.9, r * 0.45, ACCENT);
    const flow = phase % 1;
    for (let i = 0; i < 4; i++) dot(ctx, w / 2, y1 + bh + g * 1.5 + i * g * 1.4, r, (i / 4 < flow || reduced) ? ACCENT : DOT);
    const ok = phase > 1 || reduced;
    dotRect(ctx, bx, y2, bw, bh, g, r, ok ? null : null, ok ? '#7fc79a' : DOT);
    label(ctx, bx + g * 2, y2 + bh * 0.3, 'Edit src/db.ts', Math.max(9, h * 0.042), ok ? INK : '#a1a1aa', 600);
    label(ctx, bx + bw - g * 10, y2 + bh * 0.3, ok ? '✓ applied' : '…', Math.max(9, h * 0.04), ok ? '#18794e' : '#a1a1aa', 600);
    label(ctx, bx + g * 2, y2 + bh * 0.68, '+ await pool.end()', Math.max(8.5, h * 0.038), ok ? '#18794e' : '#a1a1aa');
  },
  // A version looked up over MCP, results flowing back.
  mcp(ctx, w, h, t) {
    const g = Math.max(5, w / 70), r = g * 0.3;
    const qx = w * 0.08, qy = h * 0.18, qw = w * 0.84, qh = h * 0.2;
    dotRect(ctx, qx, qy, qw, qh, g, r, null, DOT);
    const q = 'landmine_lookup vaul@1.1.2';
    const n = reduced ? q.length : Math.min(q.length, Math.floor((t * 9) % (q.length + 18)));
    label(ctx, qx + g * 2, qy + qh / 2, q.slice(0, n) + (Math.floor(t * 2) % 2 && !reduced ? '█' : ''), Math.max(9, h * 0.045), INK);
    const done = reduced || n >= q.length;
    for (let i = 0; i < 3; i++) dot(ctx, w / 2 + (i - 1) * g * 2.2, h * 0.47, r * 1.2, done ? ACCENT : DOT);
    const rows = [['emilkowalski/vaul#652', 'iOS Safari taps'], ['emilkowalski/vaul#653', 'modal + hooks'], ['+ workaround from thread', '']];
    rows.forEach(([a, b], i) => {
      const y = h * 0.6 + i * h * 0.12;
      const on = done && (reduced || t % 6 > 1 + i * 0.4);
      dotBlock(ctx, qx + g, y - g * 0.5, g, g, g, r, on ? ACCENT : DOT2);
      label(ctx, qx + g * 3.4, y, a, Math.max(8.5, h * 0.04), on ? INK : '#a1a1aa', i < 2 ? 500 : 400);
      if (b) label(ctx, qx + qw - g * 15, y, b, Math.max(8, h * 0.036), on ? '#c93c0c' : '#d4d4d8');
    });
  },
  // "Ask landmine" in dot type with a blinking cursor.
  ask(ctx, w, h, t) {
    const g = Math.max(5, w / 60), r = g * 0.32;
    dotRect(ctx, w * 0.1, h * 0.2, w * 0.8, h * 0.6, g * 1.2, r, ACCENT);
    const cells = textCells('ask landmine', 72);
    const s = (w * 0.68) / cells.cols;
    const top = h / 2 - (cells.rows * s) / 2;
    for (const c of cells.cells) dot(ctx, w * 0.16 + c.i * s, top + c.j * s, s * 0.36, c.cov > 0.5 ? INK : null, c.cov > 0.5 ? null : '#a1a1aa');
    if (reduced || Math.floor(t * 2) % 2) dotBlock(ctx, w * 0.16 + cells.cols * s + s, top, s * 2, cells.rows * s, s, s * 0.36, ACCENT);
  },
};

function scene(canvas) {
  const draw = SCENES[canvas.dataset.scene];
  if (!draw) return;
  animate(canvas, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, t);
  }, 24);
}

/** A package name in white dots for the bug cards. */
function bugArt(canvas) {
  const text = canvas.dataset.text || '';
  let cells = null;
  animate(canvas, (t) => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    cells ??= textCells(text, Math.min(78, Math.max(30, text.length * 12)));
    const s = Math.min((w * 0.74) / cells.cols, (h * 0.6) / cells.rows);
    const ox = (w - cells.cols * s) / 2, oy = (h - cells.rows * s) / 2;
    for (const c of cells.cells) {
      const tw = hash(c.i, c.j);
      const a = 0.65 + 0.35 * Math.sin(t * 1.5 + tw * 20);
      if (c.cov > 0.55) dot(ctx, ox + c.i * s, oy + c.j * s, s * 0.36, `rgba(255,255,255,${a})`);
      else dot(ctx, ox + c.i * s, oy + c.j * s, s * 0.33, null, `rgba(255,255,255,${a * 0.6})`);
    }
  }, 20);
}

const startCanvases = () => {
  for (const c of document.querySelectorAll('canvas[data-field]')) minefield(c);
  for (const c of document.querySelectorAll('canvas[data-scene]')) scene(c);
  for (const c of document.querySelectorAll('canvas[data-wordmark]')) wordmark(c);
  for (const c of document.querySelectorAll('canvas[data-bug]')) bugArt(c);
};
// Dot type needs the web font loaded before it is rasterised.
if (document.fonts?.ready) document.fonts.ready.then(startCanvases); else startCanvases();

/* ---------------------------------------------------------------- copy buttons */

const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';
async function copy(text, btn, labelled) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  btn.dataset.done = '';
  const prev = btn.innerHTML;
  btn.innerHTML = labelled ? 'Copied' : DONE_ICON;
  setTimeout(() => { delete btn.dataset.done; btn.innerHTML = prev; }, 1600);
}
for (const btn of document.querySelectorAll('[data-copy]')) {
  if (!btn.innerHTML.trim()) btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', () => copy(btn.dataset.copy, btn, btn.dataset.copyLabel !== undefined));
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

/* ---------------------------------------------------------------- nav */

const nav = document.querySelector('.nav');
nav?.querySelector('.menu-btn')?.addEventListener('click', (e) => {
  const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
nav?.querySelectorAll('.links a').forEach((a) => a.addEventListener('click', () => nav.classList.remove('open')));
const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 12);
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

/* ---------------------------------------------------------------- tabs: [role=tablist] > button[aria-controls] */

for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const pane = document.getElementById(t.getAttribute('aria-controls'));
      if (pane) pane.hidden = !on;
    }
    if (focus) tab.focus();
    tab.dispatchEvent(new CustomEvent('tabshown', { bubbles: true }));
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
}

/* ---------------------------------------------------------------- live lookup (GET /api/lookup) */

const lookupForm = document.querySelector('form[data-lookup]');
if (lookupForm) {
  const input = lookupForm.querySelector('input');
  const go = lookupForm.querySelector('.go');
  const out = document.querySelector(lookupForm.dataset.lookup);
  const samples = ['next@16.4.0', 'pandas==2.3.1', 'vaul@1.1.2', 'node-fetch@3.3.2', 'vite@8.0.16', 'sympy==1.14.0'];
  // Type example versions into the placeholder while the box is empty and idle.
  if (!reduced) {
    let si = 0, ci = 0, dir = 1, hold = 0;
    setInterval(() => {
      if (document.activeElement === input || input.value) return;
      const s = samples[si];
      if (hold > 0) { hold--; return; }
      ci += dir;
      if (ci >= s.length) { dir = -1; hold = 22; }
      if (ci <= 0) { dir = 1; si = (si + 1) % samples.length; hold = 4; }
      input.placeholder = s.slice(0, ci) + (dir > 0 ? '▌' : '');
    }, 70);
  }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const render = (results) => {
    out.replaceChildren();
    for (const r of results) {
      const pkg = el('div', 'res-pkg');
      const head = el('div', 'head');
      head.append(el('b', '', r.version ? `${r.name}${r.name.includes('/') || !r.spec.includes('==') ? '@' : '=='}${r.version}` : r.spec));
      if (r.repo) head.append(el('span', 'repo', `${r.repo}${r.latest ? ' · latest' : ''}`));
      head.append(el('span', `count${r.total ? '' : ' none'}`, r.status === 'ok' ? `${r.total} open issue${r.total === 1 ? '' : 's'}` : r.status.replace('-', ' ')));
      pkg.append(head);
      if (r.status !== 'ok' || r.total === 0) pkg.append(el('p', 'why', r.summary));
      for (const i of r.issues) {
        const a = el('a', 'issue');
        a.href = i.url; a.target = '_blank'; a.rel = 'noopener nofollow';
        a.append(el('span', 't', i.title));
        const m = el('span', 'm');
        m.append(el('span', '', i.id));
        if (i.apis.length) m.append(el('span', 'api', i.apis.map((x) => `\`${x}\``).join(' ')));
        m.append(el('span', '', `${i.strength} evidence`), el('span', '', `opened ${i.opened}`));
        if (i.reactions) m.append(el('span', '', `${i.reactions} 👍`));
        a.append(m);
        if (i.workaround?.kind === 'workaround') {
          const w = el('span', 'w');
          w.append(el('i', '', `workaround from @${i.workaround.author} (quoted, untrusted): `), document.createTextNode(i.workaround.excerpt.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 220) + (i.workaround.excerpt.length > 220 ? '…' : '')));
          a.append(w);
        }
        pkg.append(a);
      }
      if (r.total > r.issues.length) pkg.append(el('p', 'why', `+ ${r.total - r.issues.length} more. \`npx landmines lookup ${r.spec}\` lists them all.`));
      out.append(pkg);
    }
    out.append(el('p', 'fine', 'Live from GitHub through landmine.tech/api/lookup, cached for a day. Each issue was checked to name that exact version; titles and workarounds are third-party text.'));
  };
  const run = async (q) => {
    q = q.trim();
    if (!q) { input.focus(); return; }
    out.hidden = false;
    out.replaceChildren();
    const wait = el('div', 'loading');
    const cv = el('canvas');
    wait.append(cv, el('span', '', `Searching GitHub for open issues filed against ${q}…`));
    out.append(wait);
    const stop = loader(cv);
    go.disabled = true;
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      stop();
      if (!res.ok || !body.results) throw new Error(body.error || `landmine.tech returned ${res.status}`);
      render(body.results);
    } catch (err) {
      stop();
      out.replaceChildren(el('p', 'err', `${err.message || 'Lookup failed'}. Try again, or run npx landmines lookup ${q}.`));
    } finally {
      go.disabled = false;
    }
  };
  lookupForm.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
  for (const b of document.querySelectorAll('[data-try]')) b.addEventListener('click', () => { input.value = b.dataset.try; run(b.dataset.try); });
}

/* ---------------------------------------------------------------- carousel */

for (const car of document.querySelectorAll('[data-carousel]')) {
  const track = car.querySelector('.carousel');
  const pips = car.querySelector('.pips');
  const cards = [...track.children];
  pips?.replaceChildren(...cards.map(() => document.createElement('i')));
  const step = () => (cards[0]?.getBoundingClientRect().width ?? 300) + 16;
  car.querySelector('[data-prev]')?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduced ? 'auto' : 'smooth' }));
  car.querySelector('[data-next]')?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduced ? 'auto' : 'smooth' }));
  const mark = () => {
    const i = Math.round(track.scrollLeft / step());
    pips?.querySelectorAll('i').forEach((p, k) => p.classList.toggle('on', k === Math.min(i, cards.length - 1)));
  };
  track.addEventListener('scroll', mark, { passive: true });
  mark();
}

/* ---------------------------------------------------------------- reveal on scroll */

const io = 'IntersectionObserver' in window && !reduced
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' })
  : null;
for (const el of document.querySelectorAll('.reveal')) {
  if (io) io.observe(el);
  else el.classList.add('in');
}

/* ---------------------------------------------------------------- session replay */

const session = document.querySelector('.session[data-play]');
if (session && !reduced && 'IntersectionObserver' in window) {
  const steps = [...session.querySelectorAll('.step')];
  session.classList.add('play');
  const delays = steps.map((s) => Number(s.dataset.delay || 900));
  const run = () => {
    let t = 250;
    steps.forEach((s, i) => {
      t += i ? delays[i] : 0;
      setTimeout(() => s.classList.add('on'), t);
    });
  };
  const sio = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { sio.disconnect(); run(); }
  }, { rootMargin: '0px 0px -20% 0px' });
  sio.observe(session);
}

/* ---------------------------------------------------------------- dot bar charts */

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

/* ---------------------------------------------------------------- docs table of contents */

const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const tio = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      for (const a of tocLinks) {
        const on = a === byId.get(e.target.id);
        a.classList.toggle('active', on);
        if (on && matchMedia('(max-width: 960px)').matches) { const ol = a.closest('ol'); ol?.scrollTo({ left: a.offsetLeft - ol.clientWidth / 2 + a.clientWidth / 2, behavior: reduced ? 'auto' : 'smooth' }); }
      }
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const id of byId.keys()) { const s = document.getElementById(id); if (s) tio.observe(s); }
}
