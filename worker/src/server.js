const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { existsSync, mkdirSync, unlinkSync, statSync, readdirSync, readFileSync, createReadStream } = require('fs');
const { join } = require('path');
require('dotenv').config();

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3002;
const WORKER_SECRET = process.env.DJ_WORKER_SECRET || 'change-me-in-production';

// ── Config ─────────────────────────────────────────────────────────────
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const CACHE_DIR = process.env.MUSIC_CACHE_DIR || '/data/music';
const COOKIES_FILE = ['/data/youtube-cookies.txt', join(process.cwd(), 'youtube-cookies.txt')]
  .find(p => existsSync(p)) || '';

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
function isValidVideoId(id) {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

function ytdlpExtraArgs() {
  const args = ['--js-runtimes', 'node'];
  if (COOKIES_FILE && existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);
  return args;
}

// ── Middleware ──────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

const authorizeWorker = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ── Music Ripper ───────────────────────────────────────────────────────

const inProgress = new Map();

function isCached(videoId) {
  return existsSync(join(CACHE_DIR, `${videoId}.mp3`));
}

async function doRip(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tempM4a = join(CACHE_DIR, `${videoId}.m4a`);
  const finalMp3 = join(CACHE_DIR, `${videoId}.mp3`);

  try {
    console.log(`[Ripper] Downloading ${videoId}...`);
    await execFileAsync(YT_DLP, [
      ...ytdlpExtraArgs(),
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--no-playlist', '-o', tempM4a, url,
    ], { timeout: 60000 });

    if (!existsSync(tempM4a)) throw new Error('Download produced no file');

    console.log(`[Ripper] Converting ${videoId} to mp3...`);
    await execFileAsync(FFMPEG, ['-y', '-i', tempM4a, '-vn', '-ab', '128k', finalMp3], { timeout: 60000 });
    try { unlinkSync(tempM4a); } catch {}

    if (!existsSync(finalMp3)) throw new Error('Conversion produced no file');
    const size = statSync(finalMp3).size;
    console.log(`[Ripper] Cached ${videoId} (${Math.round(size / 1024)}KB)`);
    return true;
  } catch (e) {
    console.error(`[Ripper] Failed for ${videoId}:`, e.message);
    try { unlinkSync(tempM4a); } catch {}
    try { unlinkSync(finalMp3); } catch {}
    return false;
  }
}

async function ripAndCache(videoId) {
  if (isCached(videoId)) return true;
  if (inProgress.has(videoId)) return inProgress.get(videoId);
  const promise = doRip(videoId);
  inProgress.set(videoId, promise);
  try { return await promise; } finally { inProgress.delete(videoId); }
}

// ── Audio URL Extraction ───────────────────────────────────────────────

async function extractWithYtDlp(videoId) {
  try {
    console.log(`[Extract] yt-dlp for ${videoId}...`);
    const { stdout } = await execFileAsync(YT_DLP, [
      ...ytdlpExtraArgs(),
      '--no-warnings', '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--get-url', `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 30000 });
    const url = stdout.trim();
    if (url && url.startsWith('http')) {
      console.log(`[Extract] ✅ Got URL for ${videoId}`);
      return url;
    }
    return null;
  } catch (e) {
    console.log(`[Extract] yt-dlp failed: ${e.message?.slice(0, 200)}`);
    return null;
  }
}

// In-memory URL cache (5h TTL)
const urlCache = new Map();

function getCachedExtractedUrl(videoId) {
  const c = urlCache.get(videoId);
  if (c && c.expires > Date.now()) return c.url;
  urlCache.delete(videoId);
  return null;
}

function setCachedExtractedUrl(videoId, url) {
  urlCache.set(videoId, { url, expires: Date.now() + 5 * 60 * 60 * 1000 });
}

// ── Audio Routes ───────────────────────────────────────────────────────

/**
 * POST /rip — Download + convert a video to mp3
 * Body: { videoId }
 */
app.post('/rip', authorizeWorker, async (req, res) => {
  const { videoId } = req.body;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid videoId' });

  if (isCached(videoId)) {
    return res.json({ success: true, cached: true });
  }

  const ok = await ripAndCache(videoId);
  return res.json({ success: ok, cached: ok });
});

/**
 * GET /music/:videoId — Serve cached mp3
 */
app.get('/music/:videoId', authorizeWorker, (req, res) => {
  const { videoId } = req.params;
  if (!isValidVideoId(videoId)) return res.status(400).send('Invalid videoId');

  const filePath = join(CACHE_DIR, `${videoId}.mp3`);
  if (!existsSync(filePath)) return res.status(404).send('Not found');

  const stat = statSync(filePath);
  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=604800',
    'Accept-Ranges': 'bytes',
  });
  createReadStream(filePath).pipe(res);
});

/**
 * GET /extract?videoId=xxx — Extract audio URL via yt-dlp
 */
app.get('/extract', authorizeWorker, async (req, res) => {
  const { videoId } = req.query;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid videoId' });

  // Check mp3 cache first
  if (isCached(videoId)) {
    return res.json({ videoId, cached: true, source: 'mp3' });
  }

  // Check URL cache
  let url = getCachedExtractedUrl(videoId);
  if (url) {
    return res.json({ videoId, cached: false, url, source: 'url-cache' });
  }

  // Extract fresh
  url = await extractWithYtDlp(videoId);
  if (!url) return res.status(404).json({ error: 'Extraction failed' });

  setCachedExtractedUrl(videoId, url);
  return res.json({ videoId, cached: false, url, source: 'yt-dlp' });
});

/**
 * GET /stream?videoId=xxx — Stream/proxy audio (serves mp3 if cached, else proxies CDN)
 */
app.get('/stream', authorizeWorker, async (req, res) => {
  const { videoId } = req.query;
  if (!isValidVideoId(videoId)) return res.status(400).send('Invalid videoId');

  // Serve cached mp3
  const mp3Path = join(CACHE_DIR, `${videoId}.mp3`);
  if (existsSync(mp3Path)) {
    const stat = statSync(mp3Path);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400',
    });
    return createReadStream(mp3Path).pipe(res);
  }

  // Get or extract URL
  let audioUrl = getCachedExtractedUrl(videoId);
  if (!audioUrl) {
    audioUrl = await extractWithYtDlp(videoId);
    if (!audioUrl) return res.status(404).send('Extraction failed');
    setCachedExtractedUrl(videoId, audioUrl);
  }

  // Proxy from CDN
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.youtube.com/',
    };
    const rangeHeader = req.headers.range;
    if (rangeHeader) headers['Range'] = rangeHeader;

    const cdnRes = await fetch(audioUrl, { headers });

    if (!cdnRes.ok && cdnRes.status !== 206) {
      // URL expired, retry
      urlCache.delete(videoId);
      const freshUrl = await extractWithYtDlp(videoId);
      if (!freshUrl) return res.status(502).send('CDN fetch failed');
      setCachedExtractedUrl(videoId, freshUrl);

      const retryRes = await fetch(freshUrl, { headers });
      if (!retryRes.ok && retryRes.status !== 206) return res.status(502).send('CDN fetch failed after retry');
      return pipeResponse(retryRes, res);
    }

    return pipeResponse(cdnRes, res);
  } catch (err) {
    console.error(`[Stream] Proxy error for ${videoId}:`, err.message);
    return res.status(500).send('Stream error');
  }
});

function pipeResponse(cdnRes, res) {
  res.status(cdnRes.status);
  const ct = cdnRes.headers.get('content-type');
  if (ct) res.set('Content-Type', ct);
  const cl = cdnRes.headers.get('content-length');
  if (cl) res.set('Content-Length', cl);
  const cr = cdnRes.headers.get('content-range');
  if (cr) res.set('Content-Range', cr);
  res.set('Accept-Ranges', 'bytes');

  const reader = cdnRes.body.getReader();
  function pump() {
    reader.read().then(({ done, value }) => {
      if (done) { res.end(); return; }
      res.write(value);
      pump();
    }).catch(() => res.end());
  }
  pump();
}

/**
 * GET /cache-stats — Cache info
 */
app.get('/cache-stats', authorizeWorker, (req, res) => {
  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3'));
    const totalBytes = files.reduce((sum, f) => sum + statSync(join(CACHE_DIR, f)).size, 0);
    res.json({ files: files.length, totalBytes });
  } catch {
    res.json({ files: 0, totalBytes: 0 });
  }
});

// ── DJ State (Server‑side streaming) ────────────────────────────────────
/**
 * The previous implementation used Puppeteer to automate a browser and click a
 * “Start DJ” button on the client. Headless browsers cannot reliably unlock
 * WebAudio due to autoplay policies, and using Puppeteer adds significant
 * overhead. To avoid these issues, the DJ endpoint now acts as a stub for
 * server‑side streaming using LiveKit and ffmpeg. The worker will request a
 * LiveKit token from the main app, then use yt‑dlp and ffmpeg to download and
 * transcode audio, and finally publish it directly to LiveKit via the Node SDK.
 * The actual publishing logic is left as a TODO so that it can be implemented
 * incrementally.
 */

const djInstances = new Map();

async function startDjForRoom(roomId) {
  const APP_URL = process.env.APP_URL || 'https://hearmeout-main.fly.dev';
  const tokenUrl = `${APP_URL}/api/livekit-token`;
  console.log(`[DJ] Requesting LiveKit token from ${tokenUrl}`);
  let token;
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WORKER_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId,
        userName: 'HearMeOut DJ',
        musicRoom: true,
        isDJ: true,
      }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      token = json?.token;
    } else {
      const text = await res.text().catch(() => '');
      console.warn(`[DJ] Token request rejected: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[DJ] Token request failed: ${err.message}`);
  }
  // Log whether we got a token; the actual LiveKit connection should use it.
  console.log(`[DJ] Token received: ${!!token}`);
  console.log(`[DJ] (stub) Starting server‑side DJ session for ${roomId}.`);
  return {
    startedAt: new Date(),
    async stop() {
      console.log(`[DJ] (stub) Stopping server‑side DJ session for ${roomId}.`);
    },
  };
}

app.post('/dj', async (req, res) => {
  const { action, roomId } = req.body;
  if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });
  try {
    if (action === 'start') {
      if (djInstances.has(roomId)) return res.json({ success: true, message: 'DJ already running for this room.' });
      if (djInstances.size >= 3) return res.status(429).json({ success: false, message: 'Maximum concurrent DJ instances reached (3).' });
      console.log(`[DJ] Starting server‑side DJ for room ${roomId}...`);
      const instance = await startDjForRoom(roomId);
      djInstances.set(roomId, instance);
      console.log(`[DJ] Server‑side DJ started for room ${roomId}. Active: ${djInstances.size}`);
      return res.json({ success: true, message: 'DJ started.' });
    } else if (action === 'stop') {
      const instance = djInstances.get(roomId);
      if (!instance) return res.json({ success: true, message: 'No DJ running for this room.' });
      console.log(`[DJ] Stopping server‑side DJ for room ${roomId}...`);
      await instance.stop();
      djInstances.delete(roomId);
      console.log(`[DJ] Server‑side DJ stopped for room ${roomId}. Active: ${djInstances.size}`);
      return res.json({ success: true, message: 'DJ stopped.' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
  } catch (err) {
    console.error(`[DJ] Error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/dj', (req, res) => {
  const { roomId } = req.query;
  if (roomId) return res.json({ running: djInstances.has(roomId) });
  const instances = Array.from(djInstances.entries()).map(([id, instance]) => ({ roomId: id, startedAt: instance.startedAt }));
  return res.json({ instances });
});

// ── Health ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Start ───────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[DJ Worker] Server running on port ${PORT}`);
  console.log(`[DJ Worker] Cache dir: ${CACHE_DIR}`);
  console.log(`[DJ Worker] yt-dlp: ${YT_DLP}, ffmpeg: ${FFMPEG}`);
});
