// DJ Service — forwards to the hmo-dj-worker when DJ_WORKER_URL is set
// (production), falls back to local Puppeteer for development.

const DJ_WORKER_URL = process.env.DJ_WORKER_URL || '';
const DJ_WORKER_SECRET = process.env.DJ_WORKER_SECRET || '';

// ── Worker-backed implementation (production) ──────────────────────────

async function workerFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${DJ_WORKER_URL}${path}`, {
    ...options,
    headers: {
      ...((options.headers as Record<string, string>) || {}),
      Authorization: `Bearer ${DJ_WORKER_SECRET}`,
    },
  });
}

async function startDJWorker(roomId: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await workerFetch('/dj', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', roomId }),
    });
    return await res.json();
  } catch (err: any) {
    console.error('[DJ] Worker request failed:', err.message);
    return { success: false, message: `Worker error: ${err.message}` };
  }
}

async function stopDJWorker(roomId: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await workerFetch('/dj', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', roomId }),
    });
    return await res.json();
  } catch (err: any) {
    console.error('[DJ] Worker stop failed:', err.message);
    return { success: false, message: `Worker error: ${err.message}` };
  }
}

async function isDJRunningWorker(roomId: string): Promise<boolean> {
  try {
    const res = await workerFetch(`/dj?roomId=${encodeURIComponent(roomId)}`);
    const data = await res.json();
    return !!data.running;
  } catch {
    return false;
  }
}

async function getActiveInstancesWorker(): Promise<Array<{ roomId: string; startedAt: Date }>> {
  try {
    const res = await workerFetch('/dj');
    const data = await res.json();
    return (data.instances || []).map((i: any) => ({
      roomId: i.roomId,
      startedAt: new Date(i.startedAt),
    }));
  } catch {
    return [];
  }
}

// ── Local Puppeteer implementation (development) ───────────────────────

interface DJInstance {
  browser: any;
  page: any;
  roomId: string;
  startedAt: Date;
}

const localInstances = new Map<string, DJInstance>();

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';

async function startDJLocal(roomId: string): Promise<{ success: boolean; message: string }> {
  if (localInstances.has(roomId)) {
    return { success: true, message: 'DJ already running for this room.' };
  }

  if (localInstances.size >= 3) {
    return { success: false, message: 'Maximum concurrent DJ instances reached (3). Stop another room first.' };
  }

  try {
    console.log(`[DJ] Starting locally for room ${roomId}...`);

    let puppeteer: any;
    try {
      puppeteer = await import('puppeteer');
    } catch {
      return { success: false, message: 'Puppeteer not available. Set DJ_WORKER_URL for production.' };
    }

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

    page.on('console', (msg: any) => {
      const text = msg.text();
      if (text.includes('[DJ]') || text.includes('[LiveKit]') || text.includes('[YT]')) {
        console.log(`[DJ:${roomId}] ${text}`);
      }
    });

    page.on('pageerror', (err: any) => {
      console.error(`[DJ:${roomId}] Page error:`, String(err));
    });

    const djUrl = `${BASE_URL}/dj/${roomId}`;
    console.log(`[DJ] Navigating to ${djUrl}`);
    await page.goto(djUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Auto-start the session via the exposed control surface
    await page.evaluate(() => {
      if ((window as any).__HEARMEOUT_DJ__?.startSession) {
        (window as any).__HEARMEOUT_DJ__.startSession();
      }
    }).catch((err: any) => console.log(`[DJ] Auto-start eval:`, err.message));

    localInstances.set(roomId, { browser, page, roomId, startedAt: new Date() });
    console.log(`[DJ] Started for room ${roomId}. Active: ${localInstances.size}`);
    return { success: true, message: 'DJ started.' };
  } catch (err: any) {
    console.error(`[DJ] Failed to start for room ${roomId}:`, err.message);
    return { success: false, message: `Failed to start DJ: ${err.message}` };
  }
}

async function stopDJLocal(roomId: string): Promise<{ success: boolean; message: string }> {
  const instance = localInstances.get(roomId);
  if (!instance) {
    return { success: true, message: 'No DJ running for this room.' };
  }

  try {
    console.log(`[DJ] Stopping for room ${roomId}...`);
    await instance.page.close().catch(() => {});
    await instance.browser.close().catch(() => {});
    localInstances.delete(roomId);
    console.log(`[DJ] Stopped for room ${roomId}. Active: ${localInstances.size}`);
    return { success: true, message: 'DJ stopped.' };
  } catch (err: any) {
    localInstances.delete(roomId);
    return { success: false, message: `Error stopping DJ: ${err.message}` };
  }
}

// ── Public API — routes to worker or local based on config ─────────────

const useWorker = !!DJ_WORKER_URL;

export async function startDJ(roomId: string) {
  return useWorker ? startDJWorker(roomId) : startDJLocal(roomId);
}

export async function stopDJ(roomId: string) {
  return useWorker ? stopDJWorker(roomId) : stopDJLocal(roomId);
}

export function isDJRunning(roomId: string): boolean | Promise<boolean> {
  if (useWorker) return isDJRunningWorker(roomId);
  return localInstances.has(roomId);
}

export function getActiveInstances() {
  if (useWorker) return getActiveInstancesWorker();
  return Array.from(localInstances.values()).map(i => ({
    roomId: i.roomId,
    startedAt: i.startedAt,
  }));
}
