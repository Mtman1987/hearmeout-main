import puppeteer from 'puppeteer';
import { spawnSync } from 'node:child_process';

const base = String(process.env.HMO_BASE_URL || 'https://hearmeout-main.fly.dev').replace(/\/$/, '');
const roomId = `smoke-lounge-${Date.now()}`;
const sessionId = `watch-room-${roomId}-music`;
const firstUrl = process.env.HMO_SMOKE_VIDEO_A || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const secondUrl = process.env.HMO_SMOKE_VIDEO_B || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

function remoteAction(mode, value) {
  const encoded = Buffer.from(String(value || ''), 'utf8').toString('base64url');
  const command = `node --import tsx scripts/smoke-lounge-action.ts ${mode} ${sessionId} ${encoded}`;
  const result = spawnSync('flyctl', ['ssh', 'console', '-q', '-a', 'hearmeout-main', '-C', command], {
    cwd: '..',
    encoding: 'utf8',
    env: process.env,
    timeout: 60_000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const marker = output.match(/SMOKE_RESULT\s+([A-Za-z0-9_-]+)/);
  if (result.status !== 0 || !marker) {
    throw new Error(`Fly smoke action failed (exit ${result.status}): ${output.slice(-1200)}`);
  }
  return JSON.parse(Buffer.from(marker[1], 'base64url').toString('utf8'));
}

async function queue(query) {
  return remoteAction('request', query);
}

async function control(action) {
  return remoteAction('control', action);
}

const first = await queue(firstUrl);
const second = await queue(secondUrl);
const firstId = first?.request?.requestId;
const secondId = second?.request?.requestId;
if (!firstId || !secondId) throw new Error('Smoke requests did not return request IDs');
if (firstId === secondId) throw new Error('Smoke requests unexpectedly share a request ID');

let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--mute-audio',
    ],
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('[pageerror]', err.message));

  const overlayUrl = `${base}/overlay/${encodeURIComponent(roomId)}?clean=1&muted=1&volume=0`;
  await page.goto(overlayUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  async function waitForHealthy(requestId, label) {
    await page.waitForFunction(
      expected => {
        const root = document.querySelector('[data-testid="overlay-root"]');
        return root
          && root.getAttribute('data-request-id') === expected
          && root.getAttribute('data-media-healthy') === 'true';
      },
      { timeout: 90_000, polling: 500 },
      requestId,
    );
    const snapshot = await page.$eval('[data-testid="overlay-root"]', el => ({
      requestId: el.getAttribute('data-request-id'),
      title: el.getAttribute('data-media-title'),
      mode: el.getAttribute('data-player-mode'),
      healthy: el.getAttribute('data-media-healthy'),
    }));
    console.log(`${label}: ${JSON.stringify(snapshot)}`);
    await page.screenshot({ path: `/tmp/${label}.png` });
    return snapshot;
  }

  const firstSnapshot = await waitForHealthy(firstId, 'lounge-first-playing');
  const advanced = await control('next');
  if (advanced?.session?.current?.requestId !== secondId) {
    throw new Error(`Skip did not advance to the queued request. Expected ${secondId}, got ${advanced?.session?.current?.requestId || 'none'}`);
  }
  const secondSnapshot = await waitForHealthy(secondId, 'lounge-second-playing');

  if (firstSnapshot.requestId === secondSnapshot.requestId) {
    throw new Error('Browser never changed request IDs after skip');
  }
  console.log('PASS: Lounge visibly played request A, advanced, and visibly played request B.');
} finally {
  try { await control('clear'); } catch {}
  if (browser) await browser.close();
}
