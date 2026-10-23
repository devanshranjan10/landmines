/* global window, document */
// Renders scripts/video/demo.html to an MP4 (and stills) by seeking it frame by frame in headless Chromium and piping
// PNG frames into ffmpeg. Needs playwright-core (not a project dependency) and ffmpeg.
// Usage: CHROME=/path/to/chromium node scripts/video/render.mjs [out-dir] [--fps 30] [--stills 1,24,33]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const fps = Number(flag('--fps', '30'));
const stills = flag('--stills', '').split(',').filter(Boolean).map(Number);
const only = flag('--range', '');
const out = args[0] ?? 'video-out';
mkdirSync(out, { recursive: true });

const page_url = pathToFileURL(fileURLToPath(new URL('./demo.html', import.meta.url))).href;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(page_url);
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.DURATION);

for (const t of stills) {
  await page.evaluate((s) => window.seek(s), t);
  await page.screenshot({ path: join(out, `still-${t}.png`) });
}

if (!stills.length) {
  const [from, to] = only ? only.split('-').map(Number) : [0, duration];
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(out, 'landmine-demo.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.round((to - from) * fps);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((s) => window.seek(s), from + i / fps);
    const png = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % (fps * 5) === 0) process.stderr.write(`  ${(from + i / fps).toFixed(0)}s / ${to}s\n`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
}
await browser.close();
console.log(`wrote ${out}/`);
