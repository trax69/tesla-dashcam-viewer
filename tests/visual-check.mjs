// Visual smoke check (not part of `npm test`):
//   1. Screenshot of drop-zone + loaded-player states over HTTP → tests/shot-*.png
//   2. file:// boot check — app must reach the same states with zero page errors
// Run:  cd tests && node visual-check.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

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

async function launchBrowser(extraArgs = []) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-profile-'));
  const proc = spawn(findBrowser(), [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    ...extraArgs,
  ], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: { width: 1366, height: 850 },
  });
  return { browser, proc };
}

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

async function checkState(page, label) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#drop-zone:not(.hidden)');
  console.log(`PASS  ${label}: drop-zone rendered`);
  await loadSyntheticClips(page);
  console.log(`PASS  ${label}: player state loaded (3 clips)`);
  if (errors.length) {
    console.log(`FAIL  ${label}: ${errors.length} page error(s):\n  ${errors.join('\n  ')}`);
    return false;
  }
  console.log(`PASS  ${label}: zero page errors`);
  return true;
}

const server = await startServer();
const { browser, proc } = await launchBrowser();
let ok = true;

try {
  // HTTP: screenshots of both states
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,
    { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(HERE, 'shot-dropzone.png') });
  ok = (await checkState(page, 'http')) && ok;
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(HERE, 'shot-player.png') });
  console.log('Screenshots written: tests/shot-dropzone.png, tests/shot-player.png');

  // file://: same flow must boot with zero errors (main-thread SEI fallback)
  const filePage = await browser.newPage();
  await filePage.goto('file:///' + ROOT.replace(/\\/g, '/') + '/index.html',
    { waitUntil: 'networkidle0' });
  ok = (await checkState(filePage, 'file://')) && ok;
} finally {
  await browser.close().catch(() => {});
  proc.kill();
  server.close();
}

console.log(ok ? '\nVisual + file:// checks passed.' : '\nVisual checks FAILED.');
process.exit(ok ? 0 : 1);
