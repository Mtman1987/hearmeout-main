// Server-side Puppeteer DJ service
// Manages one headless Chromium instance per room
// Launches the internal /dj/{roomId} page which handles YouTube playback + LiveKit publishing

import puppeteer, { Browser, Page } from 'puppeteer';

interface DJInstance {
  browser: Browser;
  page: Page;
  roomId: string;
  startedAt: Date;
}

const instances = new Map<string, DJInstance>();

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';

export async function startDJ(roomId: string): Promise<{ success: boolean; message: string }> {
  if (instances.has(roomId)) {
    return { success: true, message: 'DJ already running for this room.' };
  }

  // Limit concurrent instances (Chromium uses ~150MB each, Fly.io has 1GB)
  if (instances.size >= 3) {
    return { success: false, message: 'Maximum concurrent DJ instances reached (3). Stop another room first.' };
  }

  try {
    console.log(`[DJ] Starting for room ${roomId}...`);

    const browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
      ],
    });

    const page = await browser.newPage();

    // Log console output from the DJ page
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[DJ]') || text.includes('[LiveKit]') || text.includes('[YT]')) {
        console.log(`[DJ:${roomId}] ${text}`);
      }
    });

    page.on('pageerror', (err) => {
      console.error(`[DJ:${roomId}] Page error:`, String(err));
    });

    // Navigate to the internal DJ page
    const djUrl = `${BASE_URL}/dj/${roomId}`;
    console.log(`[DJ] Navigating to ${djUrl}`);
    await page.goto(djUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const instance: DJInstance = { browser, page, roomId, startedAt: new Date() };
    instances.set(roomId, instance);

    console.log(`[DJ] Started for room ${roomId}. Active instances: ${instances.size}`);
    return { success: true, message: 'DJ started.' };
  } catch (err: any) {
    console.error(`[DJ] Failed to start for room ${roomId}:`, err.message);
    return { success: false, message: `Failed to start DJ: ${err.message}` };
  }
}

export async function stopDJ(roomId: string): Promise<{ success: boolean; message: string }> {
  const instance = instances.get(roomId);
  if (!instance) {
    return { success: true, message: 'No DJ running for this room.' };
  }

  try {
    console.log(`[DJ] Stopping for room ${roomId}...`);
    await instance.page.close().catch(() => {});
    await instance.browser.close().catch(() => {});
    instances.delete(roomId);
    console.log(`[DJ] Stopped for room ${roomId}. Active instances: ${instances.size}`);
    return { success: true, message: 'DJ stopped.' };
  } catch (err: any) {
    instances.delete(roomId);
    return { success: false, message: `Error stopping DJ: ${err.message}` };
  }
}

export function isDJRunning(roomId: string): boolean {
  return instances.has(roomId);
}

export function getActiveInstances(): Array<{ roomId: string; startedAt: Date }> {
  return Array.from(instances.values()).map(i => ({
    roomId: i.roomId,
    startedAt: i.startedAt,
  }));
}
