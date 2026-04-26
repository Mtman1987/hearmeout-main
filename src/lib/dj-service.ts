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

// Rooms whose startDJ() call is mid-flight. Populated synchronously before any
// `await` so a second concurrent start request for the same roomId can be
// rejected before it spawns a duplicate Chromium process (~150MB each).
const pending = new Set<string>();

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';

export async function startDJ(roomId: string): Promise<{ success: boolean; message: string }> {
  // Synchronous guards - run before any await so two concurrent callers can't
  // both pass and each launch their own Chromium. The pending check covers
  // the (long) window between launch start and `instances.set` below.
  if (instances.has(roomId)) {
    return { success: true, message: 'DJ already running for this room.' };
  }
  if (pending.has(roomId)) {
    return { success: false, message: 'DJ is already starting for this room.' };
  }

  // Limit concurrent instances (Chromium uses ~150MB each, Fly.io has 1GB).
  // Counted in-flight starts toward the cap so we don't temporarily exceed it.
  if (instances.size + pending.size >= 3) {
    return { success: false, message: 'Maximum concurrent DJ instances reached (3). Stop another room first.' };
  }

  pending.add(roomId);
  let browser: Browser | null = null;
  try {
    console.log(`[DJ] Starting for room ${roomId}...`);

    browser = await puppeteer.launch({
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

    // The DJ page exposes window.__HEARMEOUT_DJ__ = { startSession, stopSession }
    // once mounted. In a headless browser there is no human to click "Start
    // DJ Session", so we wait for that bridge and invoke startSession ourselves.
    // Without this, the page sits idle, never connects to LiveKit, and listeners
    // hear silence even though the DB shows "playing". A failure here means the
    // page can't actually publish audio, so we tear the browser down and surface
    // a real error instead of registering a useless ~150MB Chromium ghost.
    try {
      await page.waitForFunction(
        () => Boolean((window as unknown as { __HEARMEOUT_DJ__?: { startSession?: () => unknown } }).__HEARMEOUT_DJ__?.startSession),
        { timeout: 15000 }
      );
      await page.evaluate(async () => {
        const bridge = (window as unknown as { __HEARMEOUT_DJ__?: { startSession?: () => Promise<void> | void } }).__HEARMEOUT_DJ__;
        await bridge?.startSession?.();
      });
      console.log(`[DJ] startSession invoked in headless page for ${roomId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DJ:${roomId}] Failed to invoke startSession in headless page:`, message);
      await browser.close().catch(() => {});
      browser = null;
      return { success: false, message: `DJ page failed to start session: ${message}` };
    }

    const instance: DJInstance = { browser, page, roomId, startedAt: new Date() };
    instances.set(roomId, instance);

    // If Chromium crashes or the page is closed unexpectedly, drop the entry
    // so a subsequent startDJ for the same room actually relaunches instead of
    // returning the misleading "already running" no-op.
    browser.on('disconnected', () => {
      if (instances.get(roomId) === instance) {
        instances.delete(roomId);
        console.warn(`[DJ:${roomId}] Chromium disconnected, instance cleared`);
      }
    });
    page.on('close', () => {
      if (instances.get(roomId) === instance) {
        instances.delete(roomId);
        console.warn(`[DJ:${roomId}] Page closed, instance cleared`);
      }
    });

    console.log(`[DJ] Started for room ${roomId}. Active instances: ${instances.size}`);
    return { success: true, message: 'DJ started.' };
  } catch (err: any) {
    console.error(`[DJ] Failed to start for room ${roomId}:`, err.message);
    if (browser) {
      await browser.close().catch(() => {});
    }
    return { success: false, message: `Failed to start DJ: ${err.message}` };
  } finally {
    pending.delete(roomId);
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
