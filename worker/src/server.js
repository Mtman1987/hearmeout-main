const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { existsSync, mkdirSync, unlinkSync, statSync, readdirSync, createReadStream } = require('fs');
const { join } = require('path');
const { AudioSource, AudioFrame, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource } = require('@livekit/rtc-node');
require('dotenv').config();

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3002;
const WORKER_SECRET = process.env.DJ_WORKER_SECRET || 'change-me-in-production';
const APP_URL = process.env.APP_URL || 'https://hearmeout-main.fly.dev';

// ── Config ─────────────────────────────────────────────────────────────
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
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
const failedVideos = new Map(); // videoId -> { count, lastAttempt }
const MAX_RETRIES = 3;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes before retrying a failed video

function isCached(videoId) {
  return existsSync(join(CACHE_DIR, `${videoId}.m4a`)) || existsSync(join(CACHE_DIR, `${videoId}.mp3`));
}

async function doRip(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const finalM4a = join(CACHE_DIR, `${videoId}.m4a`);

  try {
    console.log(`[Ripper] Downloading ${videoId}...`);
    await execFileAsync(YT_DLP, [
      ...ytdlpExtraArgs(),
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--no-playlist', '-o', finalM4a, url,
    ], { timeout: 60000 });

    if (!existsSync(finalM4a)) throw new Error('Download produced no file');
    const size = statSync(finalM4a).size;
    console.log(`[Ripper] Cached ${videoId} as m4a (${Math.round(size / 1024)}KB)`);
    return true;
  } catch (e) {
    console.error(`[Ripper] Failed for ${videoId}:`, e.message);
    try { unlinkSync(finalM4a); } catch {}
    return false;
  }
}

async function ripAndCache(videoId) {
  if (isCached(videoId)) return true;
  // Check if this video has failed too many times recently
  const failed = failedVideos.get(videoId);
  if (failed && failed.count >= MAX_RETRIES && (Date.now() - failed.lastAttempt) < RETRY_COOLDOWN_MS) {
    console.log(`[Ripper] Skipping ${videoId} — failed ${failed.count} times, cooldown until ${new Date(failed.lastAttempt + RETRY_COOLDOWN_MS).toISOString()}`);
    return false;
  }
  if (inProgress.has(videoId)) return inProgress.get(videoId);
  const promise = doRip(videoId);
  inProgress.set(videoId, promise);
  try {
    const result = await promise;
    if (result) {
      failedVideos.delete(videoId);
    } else {
      const prev = failedVideos.get(videoId) || { count: 0, lastAttempt: 0 };
      failedVideos.set(videoId, { count: prev.count + 1, lastAttempt: Date.now() });
    }
    return result;
  } finally { inProgress.delete(videoId); }
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
app.post('/rip', authorizeWorker, async (req, res) => {
  const { videoId } = req.body;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid videoId' });
  if (isCached(videoId)) return res.json({ success: true, cached: true });
  const ok = await ripAndCache(videoId);
  return res.json({ success: ok, cached: ok });
});

app.get('/music/:videoId', authorizeWorker, (req, res) => {
  const { videoId } = req.params;
  if (!isValidVideoId(videoId)) return res.status(400).send('Invalid videoId');
  let filePath = join(CACHE_DIR, `${videoId}.m4a`);
  let contentType = 'audio/mp4';
  if (!existsSync(filePath)) {
    filePath = join(CACHE_DIR, `${videoId}.mp3`);
    contentType = 'audio/mpeg';
  }
  if (!existsSync(filePath)) return res.status(404).send('Not found');
  const stat = statSync(filePath);
  res.set({ 'Content-Type': contentType, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=604800', 'Accept-Ranges': 'bytes' });
  createReadStream(filePath).pipe(res);
});

app.get('/extract', authorizeWorker, async (req, res) => {
  const { videoId } = req.query;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid videoId' });
  if (existsSync(join(CACHE_DIR, `${videoId}.m4a`))) return res.json({ videoId, cached: true, source: 'm4a' });
  if (existsSync(join(CACHE_DIR, `${videoId}.mp3`))) return res.json({ videoId, cached: true, source: 'mp3' });
  let url = getCachedExtractedUrl(videoId);
  if (url) return res.json({ videoId, cached: false, url, source: 'url-cache' });
  url = await extractWithYtDlp(videoId);
  if (!url) return res.status(404).json({ error: 'Extraction failed' });
  setCachedExtractedUrl(videoId, url);
  return res.json({ videoId, cached: false, url, source: 'yt-dlp' });
});

app.get('/stream', authorizeWorker, async (req, res) => {
  const { videoId } = req.query;
  if (!isValidVideoId(videoId)) return res.status(400).send('Invalid videoId');
  const m4aPath = join(CACHE_DIR, `${videoId}.m4a`);
  if (existsSync(m4aPath)) {
    const stat = statSync(m4aPath);
    res.set({ 'Content-Type': 'audio/mp4', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
    return createReadStream(m4aPath).pipe(res);
  }
  const mp3Path = join(CACHE_DIR, `${videoId}.mp3`);
  if (existsSync(mp3Path)) {
    const stat = statSync(mp3Path);
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
    return createReadStream(mp3Path).pipe(res);
  }
  let audioUrl = getCachedExtractedUrl(videoId);
  if (!audioUrl) {
    audioUrl = await extractWithYtDlp(videoId);
    if (!audioUrl) return res.status(404).send('Extraction failed');
    setCachedExtractedUrl(videoId, audioUrl);
  }
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.youtube.com/' };
    if (req.headers.range) headers['Range'] = req.headers.range;
    const cdnRes = await fetch(audioUrl, { headers });
    if (!cdnRes.ok && cdnRes.status !== 206) {
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
  (function pump() {
    reader.read().then(({ done, value }) => {
      if (done) { res.end(); return; }
      res.write(value);
      pump();
    }).catch(() => res.end());
  })();
}

app.get('/cache-stats', authorizeWorker, (req, res) => {
  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3') || f.endsWith('.m4a'));
    const totalBytes = files.reduce((sum, f) => sum + statSync(join(CACHE_DIR, f)).size, 0);
    res.json({ files: files.length, totalBytes });
  } catch { res.json({ files: 0, totalBytes: 0 }); }
});

// ══════════════════════════════════════════════════════════════════════════
// ── DJ Engine — Server-side LiveKit audio publishing via ffmpeg ──────────
// ══════════════════════════════════════════════════════════════════════════

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2; // 16-bit PCM = 2 bytes/sample

class DJSession {
  constructor(roomId) {
    this.roomId = roomId;
    this.startedAt = new Date();
    this.lkRoom = null;
    this.audioSource = null;
    this.localTrack = null;
    this.ffmpegProcess = null;
    this.pollInterval = null;
    this.currentVideoId = null;
    this.stopped = false;
    this.playing = false;
  }

  async start() {
    console.log(`[DJ:${this.roomId}] Starting session...`);

    // Get LiveKit token from main app
    const token = await this.getLiveKitToken();
    if (!token) throw new Error('Failed to get LiveKit token');

    const livekitUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!livekitUrl) throw new Error('LIVEKIT_URL not configured. Set LIVEKIT_URL or NEXT_PUBLIC_LIVEKIT_URL');

    // Connect to LiveKit
    this.lkRoom = new Room();
    await this.lkRoom.connect(livekitUrl, token);
    console.log(`[DJ:${this.roomId}] Connected to LiveKit room: ${this.roomId}-music`);

    // Create audio source and publish track
    this.audioSource = new AudioSource(SAMPLE_RATE, CHANNELS);
    this.localTrack = LocalAudioTrack.createAudioTrack('dj-music', this.audioSource);
    await this.lkRoom.localParticipant.publishTrack(this.localTrack, new TrackPublishOptions({
      source: TrackSource.MICROPHONE,
    }));
    console.log(`[DJ:${this.roomId}] Audio track published`);

    // Start polling room state for track changes
    this.startPolling();

    // Update room state
    await this.patchRoom({ djActive: true, djStatus: 'DJ connected' });
  }

  async getLiveKitToken() {
    try {
      const res = await fetch(`${APP_URL}/api/livekit-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WORKER_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId: this.roomId,
          userName: 'HearMeOut DJ',
          musicRoom: true,
          isDJ: true,
        }),
      });
      if (!res.ok) {
        console.error(`[DJ:${this.roomId}] Token request failed: ${res.status}`);
        return null;
      }
      const { token } = await res.json();
      return token;
    } catch (err) {
      console.error(`[DJ:${this.roomId}] Token request error:`, err.message);
      return null;
    }
  }

  startPolling() {
    this.pollInterval = setInterval(() => this.pollRoom(), 2000);
    this.pollRoom(); // immediate first poll
  }

  async pollRoom() {
    if (this.stopped) return;
    try {
      const res = await fetch(`${APP_URL}/api/db?collection=rooms&id=${this.roomId}`);
      const result = await res.json();
      if (!result?.exists) return;

      const data = result.data;
      const { currentTrackId, isPlaying, playlist, autoRadio, playHistory } = data;

      if (!currentTrackId || !isPlaying) {
        if (this.playing) this.stopPlayback();
        if (!currentTrackId && autoRadio) {
          this.requestAutoRadio();
        }
        return;
      }

      // Track changed — load new audio
      if (currentTrackId !== this.currentVideoId) {
        const track = playlist?.find(t => t.id === currentTrackId);
        const videoId = this.extractVideoId(currentTrackId, track?.url);
        console.log(`[DJ:${this.roomId}] Track changed: ${videoId} (${track?.title || 'unknown'})`);
        this.currentVideoId = currentTrackId;
        await this.patchRoom({ djStatus: `Playing: ${track?.title || videoId}` });
        await this.playTrack(videoId, data);
      } else if (!this.playing && isPlaying) {
        // Resume if paused
        const track = playlist?.find(t => t.id === currentTrackId);
        const videoId = this.extractVideoId(currentTrackId, track?.url);
        await this.playTrack(videoId, data);
      }
    } catch (err) {
      // Non-fatal poll error
    }
  }

  extractVideoId(trackId, trackUrl) {
    if (trackUrl) {
      try {
        const u = new URL(trackUrl);
        return u.searchParams.get('v') || u.pathname.slice(1) || trackId;
      } catch {}
    }
    return trackId;
  }

  async playTrack(videoId, roomData) {
    this.stopPlayback();
    if (this.stopped) return;

    // Ensure audio is cached
    const cached = await ripAndCache(videoId);
    if (!cached) {
      console.error(`[DJ:${this.roomId}] Failed to cache ${videoId}, skipping`);
      await this.patchRoom({ djStatus: `Failed: ${videoId}` });
      setTimeout(() => this.advanceTrack(roomData), 500);
      return;
    }

    // Find cached file
    let filePath = join(CACHE_DIR, `${videoId}.m4a`);
    if (!existsSync(filePath)) filePath = join(CACHE_DIR, `${videoId}.mp3`);
    if (!existsSync(filePath)) {
      console.error(`[DJ:${this.roomId}] Cache file missing for ${videoId}`);
      setTimeout(() => this.advanceTrack(roomData), 500);
      return;
    }

    console.log(`[DJ:${this.roomId}] Playing ${filePath}`);
    this.playing = true;

    // Spawn ffmpeg to decode to raw PCM s16le stereo 48kHz
    this.ffmpegProcess = spawn('ffmpeg', [
      '-i', filePath,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-loglevel', 'error',
      'pipe:1',
    ]);

    let buffer = Buffer.alloc(0);

    this.ffmpegProcess.stdout.on('data', (chunk) => {
      if (this.stopped) return;
      buffer = Buffer.concat([buffer, chunk]);

      // Feed frames to LiveKit audio source
      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);

        // Convert to Int16Array — use subarray to avoid buffer.slice instability
        const samples = new Int16Array(frameData.buffer, frameData.byteOffset, frameData.length / 2);
        const audioFrame = new AudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);
        try {
          this.audioSource.captureFrame(audioFrame);
        } catch (err) {
          // Audio source may be closed
        }
      }
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.warn(`[DJ:${this.roomId}] ffmpeg: ${msg}`);
    });

    this.ffmpegProcess.on('close', (code) => {
      if (this.stopped) return;
      console.log(`[DJ:${this.roomId}] ffmpeg exited (code ${code}), track ended`);
      this.playing = false;
      this.ffmpegProcess = null;
      // Auto-advance to next track
      this.advanceTrack(roomData);
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error(`[DJ:${this.roomId}] ffmpeg error:`, err.message);
      this.playing = false;
      this.ffmpegProcess = null;
    });
  }

  stopPlayback() {
    if (this.ffmpegProcess) {
      try { this.ffmpegProcess.kill('SIGTERM'); } catch {}
      this.ffmpegProcess = null;
    }
    this.playing = false;
  }

  async advanceTrack(roomData) {
    if (this.stopped) return;
    const { playlist, currentTrackId, autoRadio, playHistory } = roomData;

    if (!playlist?.length) {
      if (autoRadio) this.requestAutoRadio();
      return;
    }

    const idx = playlist.findIndex(t => t.id === currentTrackId);
    const isLast = idx === playlist.length - 1;

    if (isLast && autoRadio) {
      this.requestAutoRadio();
      return;
    }

    const next = playlist[(idx + 1) % playlist.length];
    if (!next || next.id === currentTrackId) return;

    const updates = { currentTrackId: next.id, isPlaying: true };
    if (currentTrackId) {
      updates.playHistory = [...(playHistory || []), currentTrackId].slice(-50);
    }

    await this.patchRoom(updates);
  }

  requestAutoRadio() {
    fetch(`${APP_URL}/api/auto-radio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: this.roomId }),
    }).catch(() => {});
  }

  async patchRoom(data) {
    try {
      await fetch(`${APP_URL}/api/db`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'rooms', id: this.roomId, data }),
      });
    } catch {}
  }

  async stop() {
    console.log(`[DJ:${this.roomId}] Stopping session`);
    this.stopped = true;
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.stopPlayback();

    if (this.localTrack) {
      try { await this.lkRoom?.localParticipant.unpublishTrack(this.localTrack); } catch {}
    }
    if (this.lkRoom) {
      try { await this.lkRoom.disconnect(); } catch {}
    }

    await this.patchRoom({ djActive: false, isPlaying: false, djStatus: 'DJ stopped' });
    console.log(`[DJ:${this.roomId}] Session stopped`);
  }
}

// ── DJ API ──────────────────────────────────────────────────────────────
const djInstances = new Map();

app.post('/dj', async (req, res) => {
  const { action, roomId } = req.body;
  if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });

  try {
    if (action === 'start') {
      if (djInstances.has(roomId)) return res.json({ success: true, message: 'DJ already running.' });
      if (djInstances.size >= 5) return res.status(429).json({ success: false, message: 'Max concurrent DJ instances reached (5).' });

      const session = new DJSession(roomId);
      djInstances.set(roomId, session);
      // Start async — don't block the response
      session.start().catch(err => {
        console.error(`[DJ:${roomId}] Start failed:`, err.message);
        djInstances.delete(roomId);
      });
      return res.json({ success: true, message: 'DJ starting...' });
    }

    if (action === 'stop') {
      const session = djInstances.get(roomId);
      if (!session) return res.json({ success: true, message: 'No DJ running.' });
      await session.stop();
      djInstances.delete(roomId);
      return res.json({ success: true, message: 'DJ stopped.' });
    }

    return res.status(400).json({ success: false, message: 'Invalid action' });
  } catch (err) {
    console.error(`[DJ] Error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/dj', (req, res) => {
  const { roomId } = req.query;
  if (roomId) return res.json({ running: djInstances.has(roomId) });
  const instances = Array.from(djInstances.entries()).map(([id, s]) => ({ roomId: id, startedAt: s.startedAt }));
  return res.json({ instances });
});

// ── Health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeDJs: djInstances.size });
});

// ── Start ───────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[DJ Worker] Server running on port ${PORT}`);
  console.log(`[DJ Worker] App URL: ${APP_URL}`);
  console.log(`[DJ Worker] Cache dir: ${CACHE_DIR}`);
  console.log(`[DJ Worker] yt-dlp: ${YT_DLP}`);
});
