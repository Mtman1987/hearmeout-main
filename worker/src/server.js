const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;
const WORKER_SECRET = process.env.DJ_WORKER_SECRET || 'change-me-in-production';

// ──────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Auth middleware
const authorizeWorker = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ──────────────────────────────────────────────────────────────────────
// DJ State
// ──────────────────────────────────────────────────────────────────────

const djInstances = new Map(); // roomId -> { browser, page, roomId, startedAt }

// ──────────────────────────────────────────────────────────────────────
// DJ Routes
// ──────────────────────────────────────────────────────────────────────

/**
 * POST /dj
 * Start or stop a DJ instance
 * Body: { action: 'start' | 'stop', roomId: string }
 */
app.post('/dj', authorizeWorker, async (req, res) => {
  const { action, roomId } = req.body;

  if (!roomId) {
    return res.status(400).json({ success: false, message: 'Missing roomId' });
  }

  try {
    if (action === 'start') {
      if (djInstances.has(roomId)) {
        return res.json({ success: true, message: 'DJ already running for this room.' });
      }

      if (djInstances.size >= 3) {
        return res.status(429).json({
          success: false,
          message: 'Maximum concurrent DJ instances reached (3). Stop another room first.',
        });
      }

      console.log(`[DJ] Starting for room ${roomId}...`);

      let puppeteer;
      try {
        puppeteer = require('puppeteer');
      } catch {
        return res.status(500).json({
          success: false,
          message: 'Puppeteer not available on worker.',
        });
      }

      const browser = await puppeteer.launch({
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

      page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[DJ]') || text.includes('[LiveKit]') || text.includes('[YT]')) {
          console.log(`[DJ:${roomId}] ${text}`);
        }
      });

      page.on('pageerror', (err) => {
        console.error(`[DJ:${roomId}] Page error:`, String(err));
      });

      const APP_URL = process.env.APP_URL || 'https://hearmeout-main.fly.dev';
      const djUrl = `${APP_URL}/dj/${roomId}`;
      console.log(`[DJ] Navigating to ${djUrl}`);

      await page.goto(djUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Auto-start the session via the exposed control surface
      await page
        .evaluate(() => {
          if ((window).__HEARMEOUT_DJ__?.startSession) {
            (window).__HEARMEOUT_DJ__.startSession();
          }
        })
        .catch((err) => console.log(`[DJ] Auto-start eval:`, err.message));

      djInstances.set(roomId, { browser, page, roomId, startedAt: new Date() });
      console.log(`[DJ] Started for room ${roomId}. Active: ${djInstances.size}`);

      return res.json({ success: true, message: 'DJ started.' });
    } else if (action === 'stop') {
      const instance = djInstances.get(roomId);
      if (!instance) {
        return res.json({ success: true, message: 'No DJ running for this room.' });
      }

      try {
        console.log(`[DJ] Stopping for room ${roomId}...`);
        await instance.page.close().catch(() => {});
        await instance.browser.close().catch(() => {});
        djInstances.delete(roomId);
        console.log(`[DJ] Stopped for room ${roomId}. Active: ${djInstances.size}`);
        return res.json({ success: true, message: 'DJ stopped.' });
      } catch (err) {
        djInstances.delete(roomId);
        return res.status(500).json({ success: false, message: `Error stopping DJ: ${err.message}` });
      }
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
  } catch (err) {
    console.error(`[DJ] Error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /dj
 * Check if a DJ is running or list all active instances
 * Query: roomId (optional)
 */
app.get('/dj', authorizeWorker, (req, res) => {
  const { roomId } = req.query;

  if (roomId) {
    const running = djInstances.has(roomId);
    return res.json({ running });
  }

  const instances = Array.from(djInstances.values()).map((i) => ({
    roomId: i.roomId,
    startedAt: i.startedAt,
  }));

  return res.json({ instances });
});

// ──────────────────────────────────────────────────────────────────────
// Health Check
// ──────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ──────────────────────────────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[DJ Worker] Server running on port ${PORT}`);
  console.log(`[DJ Worker] Worker secret configured: ${!!WORKER_SECRET}`);
});
