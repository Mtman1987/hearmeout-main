import puppeteer from 'puppeteer';

const base = String(process.env.HMO_BASE_URL || 'https://hearmeout-main.fly.dev').replace(/\/$/, '');
const roomId = 'system-spacemountainlive-lounge';
const sessionId = `watch-room-${roomId}-music`;
const firstUrl = process.env.HMO_SMOKE_VIDEO_A || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const secondUrl = process.env.HMO_SMOKE_VIDEO_B || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  let payload = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { raw: body }; }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body.slice(0, 500)}`);
  return payload;
}

async function loungeAction(payload) {
  return json(`${base}/api/internal/bot/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      tenantId: 'spacemountainlive',
      sessionId,
      actorUserId: 'production-smoke',
      actorName: 'Production Smoke',
      actorRole: 'owner',
      ...payload,
    }),
  });
}

async function queue(query) {
  return loungeAction({
    action: 'hmo.media.request',
    lane: 'music',
    query,
  });
}

async function control(control) {
  return loungeAction({
    action: 'hmo.media.control',
    lane: 'music',
    control,
  });
}

await control('clear').catch(() => {});
const first = await queue(firstUrl);
const second = await queue(secondUrl);
await control('play');
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
