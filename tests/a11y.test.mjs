// WCAG 2.2 AA verification for Tesla Dashcam Viewer.
//
// 1. Token contrast matrix   — WCAG 1.4.3 (text 4.5:1) / 1.4.11 (non-text 3:1)
// 2. axe-core scan           — tags wcag2a/aa, wcag21a/aa, wcag22aa, on the
//                              drop-zone state AND the loaded-player state
// 3. Keyboard operability    — WCAG 2.1.1: Tab reaches clips, Enter activates,
//                              arrow keys move the seek slider
//
// Run:  cd tests && npm install && npm test
// Uses the locally installed Edge/Chrome via puppeteer-core (no download).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const report = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// ── 1. Contrast matrix ────────────────────────────────────────────────────────

function luminance(hex) {
  const c = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
// Alpha-blend fg (white at `alpha`) over hex bg → solid hex
function whiteOver(bg, alpha) {
  const c = bg.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  const m = c.map((v) => Math.round(v * (1 - alpha) + 255 * alpha));
  return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function testContrast() {
  console.log('\n── Contrast (WCAG 1.4.3 / 1.4.11) ──');
  const tokensCss = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
  const tok = (name) => {
    const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    if (!m) throw new Error(`token --${name} not found in tokens.css`);
    return m[1];
  };
  const surface = tok('surface'), bg = tok('bg');

  const pairs = [
    ['--text on --surface (body text)',                tok('text'),       surface, 4.5],
    ['--text-muted on --surface (secondary text)',     tok('text-muted'), surface, 4.5],
    ['--text-dim on --surface (labels, hints)',        tok('text-dim'),   surface, 4.5],
    ['--text-dim on --bg',                             tok('text-dim'),   bg,      4.5],
    ['--text-dim on --surface-2 (active/hover cards)', tok('text-dim'),   tok('surface-2'), 4.5],
    ['--text-dim on --surface-3 (worst-case surface)', tok('text-dim'),   tok('surface-3'), 4.5],
    ['--accent on --surface (focus outline, 1.4.11)',  tok('accent'),     surface, 3],
    ['--accent on --bg (focus outline, 1.4.11)',       tok('accent'),     bg,      3],
    ['--accent on --surface-2 (scrubber fill/track)',  tok('accent'),     tok('surface-2'), 3],
    ['white on --accent (drop-zone CTA text)',         '#ffffff',         tok('accent'), 4.5],
    ['HUD unit text (55% white) on --surface',         whiteOver(surface, 0.55), surface, 4.5],
    ['HUD autopilot text (62% white) on --surface',    whiteOver(surface, 0.62), surface, 4.5],
    ['HUD FSD blue #7da1f7 on --surface',              '#7da1f7',         surface, 4.5],
    // cam-label worst case: chip rgba(10,11,14,.78) over pure-white video
    ['cam-label text on chip over white video',        whiteOver('#414246', 0.95), '#414246', 4.5],
  ];
  for (const [name, fg, back, min] of pairs) {
    const r = contrast(fg, back);
    report(r >= min, `${r.toFixed(2)}:1 (min ${min}:1)  ${name}`);
  }
}

// ── Static server + browser helpers ──────────────────────────────────────────

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.proto': 'text/plain' };

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Edge/Chrome found — set BROWSER_PATH');
  return found;
}

// ── 2. axe-core ───────────────────────────────────────────────────────────────

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function runAxe(page, label) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(
    (tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    AXE_TAGS
  );
  for (const v of result.violations) {
    console.log(`        ✗ [${v.impact}] ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`          ${n.target.join(' ')}`);
  }
  report(result.violations.length === 0,
    `axe-core (${AXE_TAGS.join(',')}) — ${label}: ${result.violations.length} violations`);
  if (result.incomplete.length) {
    console.log(`        (i) ${result.incomplete.length} incomplete checks (manual review): ` +
      result.incomplete.map((v) => v.id).join(', '));
  }
}

// Build synthetic Tesla clips in the page and load them through the real path
async function loadSyntheticClips(page) {
  await page.evaluate(() => {
    const mk = (name) => new File([new Uint8Array(64)], name, { type: 'video/mp4' });
    loadFolder([
      mk('2024-08-05_23-19-26-front.mp4'), mk('2024-08-05_23-19-26-back.mp4'),
      mk('2024-08-05_23-21-49-front.mp4'), mk('2024-08-05_23-21-49-left_repeater.mp4'),
      mk('2024-08-05_23-24-10-front.mp4'),
    ]);
  });
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForFunction(
    () => document.getElementById('loading-overlay').classList.contains('hidden'),
    { timeout: 10_000 }
  );
}

// ── 3. Keyboard operability ───────────────────────────────────────────────────

async function testKeyboard(page) {
  console.log('\n── Keyboard (WCAG 2.1.1) ──');

  // Tab from the top must reach the clip list buttons
  await page.evaluate(() => document.getElementById('btn-load-folder').focus());
  let reachedClip = false;
  for (let i = 0; i < 30 && !reachedClip; i++) {
    await page.keyboard.press('Tab');
    reachedClip = await page.evaluate(
      () => document.activeElement?.classList.contains('clip-item') ?? false);
  }
  report(reachedClip, 'Tab order reaches the clip list buttons');

  // Enter on a focused clip activates it (aria-current moves)
  await page.evaluate(() => document.querySelectorAll('.clip-item')[2].focus());
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelectorAll('.clip-item')[2].getAttribute('aria-current') === 'true',
    { timeout: 10_000 }
  );
  report(true, 'Enter activates a clip (aria-current follows)');

  // Arrow keys operate the seek slider
  const moved = await page.evaluate(() => {
    const s = document.getElementById('scrubber');
    s.focus();
    return +s.value;
  });
  await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => +document.getElementById('scrubber').value);
  report(after > moved, `Arrow keys move the seek slider (${moved} → ${after})`);

  // Camera toggle reflects state for AT
  const pressed = await page.evaluate(() => {
    document.querySelector('[data-cam="front"]').click();
    return {
      front: document.querySelector('[data-cam="front"]').getAttribute('aria-pressed'),
      quad: document.getElementById('btn-cam-quad').getAttribute('aria-pressed'),
    };
  });
  report(pressed.front === 'true' && pressed.quad === 'false',
    'Camera buttons expose aria-pressed state');
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Spawn the browser ourselves and attach via the DevTools HTTP endpoint —
// more portable than puppeteer.launch (no stdio handshake, works in
// restricted/sandboxed shells and on managed machines).
async function launchBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-profile-'));
  const proc = spawn(findBrowser(), [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  ], { stdio: 'ignore' });

  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(portFile)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!fs.existsSync(portFile)) throw new Error('Browser DevTools endpoint never came up');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: { width: 1366, height: 850 },
  });
  return { browser, proc };
}

const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const { browser, proc: browserProc } = await launchBrowser();

try {
  testContrast();

  console.log('\n── axe-core (WCAG 2.2 AA) ──');
  const page = await browser.newPage();
  page.on('pageerror', (e) => report(false, `page error: ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle0' });

  await runAxe(page, 'drop-zone state');

  await loadSyntheticClips(page);
  await runAxe(page, 'loaded-player state');

  await testKeyboard(page);
} finally {
  await browser.close().catch(() => {});
  browserProc.kill();
  server.close();
}

console.log(failures === 0
  ? '\nAll accessibility checks passed (WCAG 2.2 AA target).'
  : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
