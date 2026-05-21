const { resolve, join } = require('path');
const rootDir = resolve(__dirname, '..', '..');

// In Docker/production, env vars are injected directly.
// In local dev, load from root .env.local and .env files.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: resolve(rootDir, '.env.local') });
  require('dotenv').config({ path: resolve(rootDir, '.env') });
}

const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { existsSync, mkdirSync, unlinkSync, statSync, readdirSync, createReadStream } = require('fs');
const { AudioSource, AudioFrame, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource } = require('@livekit/rtc-node');
const wrtc = require('@roamhq/wrtc');
const puppeteer = require('puppeteer');

Object.assign(globalThis, {
  RTCPeerConnection: wrtc.RTCPeerConnection,
  RTCSessionDescription: wrtc.RTCSessionDescription,
  RTCIceCandidate: wrtc.RTCIceCandidate,
  MediaStream: wrtc.MediaStream,
  MediaStreamTrack: wrtc.MediaStreamTrack,
});
const { Peer } = require('peerjs');

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3002;
const APP_URL = process.env.APP_URL || 'https://hearmeout-main.fly.dev';
const WORKER_CALLBACK_HEADERS = { 'x-hmo-dj-worker': '1' };
const DEFAULT_WINDOWS_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROMIUM_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32' && existsSync(DEFAULT_WINDOWS_CHROME) ? DEFAULT_WINDOWS_CHROME : '/usr/bin/chromium');
const EXTRACTOR_USER_DATA_DIR =
  process.env.EXTRACTOR_USER_DATA_DIR ||
  process.env.PUPPETEER_USER_DATA_DIR ||
  join(rootDir, '.tmp-chrome-profile');
const EXTRACTOR_PROFILE_DIR = process.env.EXTRACTOR_PROFILE_DIR || process.env.PUPPETEER_PROFILE_DIR || 'Default';
const UPSTREAM_EXTRACTOR_URL = (process.env.UPSTREAM_EXTRACTOR_URL || process.env.LOCAL_EXTRACTOR_URL || '').replace(/\/+$/, '');
const UPSTREAM_EXTRACTOR_SECRET = process.env.UPSTREAM_EXTRACTOR_SECRET || process.env.LOCAL_EXTRACTOR_SECRET || '';
const CACHE_DIR = process.env.MUSIC_CACHE_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/music' : join(__dirname, '..', '.cache', 'music'));

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
function isValidVideoId(id) {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

// ── Middleware ──────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

const authorizeWorker = (req, res, next) => {
  next();
};

// ── Music Ripper ───────────────────────────────────────────────────────
function isCached(videoId) {
  return existsSync(join(CACHE_DIR, `${videoId}.m4a`)) || existsSync(join(CACHE_DIR, `${videoId}.mp3`));
}

async function doRip(videoId) {
  console.warn(`[Ripper] Legacy extraction is disabled for ${videoId}`);
  return false;
}

const urlCache = new Map();
function getCachedExtractedInfo(videoId) {
  const c = urlCache.get(videoId);
  if (c && c.expires > Date.now()) return c.info;
  urlCache.delete(videoId);
  return null;
}
function getCachedExtractedUrl(videoId) {
  return getCachedExtractedInfo(videoId)?.url || null;
}
function setCachedExtractedInfo(videoId, info) {
  urlCache.set(videoId, { info, expires: Date.now() + 5 * 60 * 60 * 1000 });
}

function getMimeFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.searchParams.get('mime') || '';
  } catch {
    return '';
  }
}

function normalizeContentType(value) {
  return (value || '').split(';')[0].trim().toLowerCase();
}

function isAudioCandidate(rawUrl, contentType) {
  const responseType = normalizeContentType(contentType);
  const queryType = normalizeContentType(getMimeFromUrl(rawUrl));
  return responseType.startsWith('audio/') || queryType.startsWith('audio/');
}

async function extractDirectAudioFormat(videoId) {
  const { Innertube, ClientType } = await import('youtubei.js');
  const clients = ['ANDROID_VR', 'ANDROID', 'IOS', 'TV', 'MWEB', 'MUSIC', 'WEB'];

  for (const client of clients) {
    try {
      const yt = await Innertube.create({ client_type: ClientType?.[client] || client });
      const info = await yt.getBasicInfo(videoId);
      const formats = info.streaming_data?.adaptive_formats || [];
      const audioFormats = formats
        .filter((format) => {
          const mimeType = format.mime_type || format.mimeType || '';
          return String(mimeType).startsWith('audio/') || (format.has_audio && !format.has_video);
        })
        .sort((a, b) => {
          const aMime = String(a.mime_type || a.mimeType || '');
          const bMime = String(b.mime_type || b.mimeType || '');
          const aMp4 = aMime.includes('audio/mp4') ? 1 : 0;
          const bMp4 = bMime.includes('audio/mp4') ? 1 : 0;
          return (bMp4 - aMp4) || ((Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
        });
      console.log(`[Extract] ${client} direct lookup returned ${audioFormats.length} audio formats for ${videoId}`);

      for (const format of audioFormats) {
        let url = format.url;
        if (!url && typeof format.decipher === 'function') {
          url = await format.decipher(yt.session.player).catch(() => null);
        }
        if (!url) continue;
        return {
          url,
          mimeType: format.mime_type || format.mimeType || getMimeFromUrl(url) || 'audio/mp4',
        };
      }
    } catch (err) {
      console.warn(`[Extract] ${client} direct format lookup failed: ${err.message?.slice(0, 120)}`);
    }
  }

  return null;
}

async function extractFromUpstream(videoId) {
  if (!UPSTREAM_EXTRACTOR_URL) return null;

  const endpoint = `${UPSTREAM_EXTRACTOR_URL}/extract?videoId=${encodeURIComponent(videoId)}`;
  const headers = UPSTREAM_EXTRACTOR_SECRET
    ? { Authorization: `Bearer ${UPSTREAM_EXTRACTOR_SECRET}` }
    : {};

  try {
    console.log(`[Extract] Asking upstream browser extractor for ${videoId}`);
    const res = await fetch(endpoint, { headers });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) {
      console.warn(`[Extract] Upstream extractor failed for ${videoId}: ${res.status} ${data?.error || ''}`);
      return null;
    }
    return {
      url: data.url,
      mimeType: data.mimeType || getMimeFromUrl(data.url) || 'application/octet-stream',
      duration: Number(data.duration || 0),
      title: data.title || 'Unknown',
      artist: data.artist || 'Unknown',
    };
  } catch (err) {
    console.warn(`[Extract] Upstream extractor error for ${videoId}: ${err.message?.slice(0, 160)}`);
    return null;
  }
}

async function extractAudioInfo(videoId) {
  const cached = getCachedExtractedInfo(videoId);
  if (cached) return cached;

  const upstreamInfo = await extractFromUpstream(videoId);
  if (upstreamInfo?.url) {
    setCachedExtractedInfo(videoId, upstreamInfo);
    return upstreamInfo;
  }

  const directAudio = await extractDirectAudioFormat(videoId);
  if (directAudio?.url) {
    const info = {
      url: directAudio.url,
      mimeType: directAudio.mimeType || 'application/octet-stream',
      duration: 0,
      title: 'Unknown',
      artist: 'Unknown',
    };
    setCachedExtractedInfo(videoId, info);
    return info;
  }

  console.warn(`[Extract] Browser capture starting for ${videoId}`);
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    userDataDir: EXTRACTOR_USER_DATA_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--profile-directory=${EXTRACTOR_PROFILE_DIR}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  let capturedUrl = null;
  let capturedContentType = null;
  let firstMediaUrl = null;
  let firstMediaContentType = null;

  page.on('response', async (resp) => {
    if (capturedUrl) return;
    const url = resp.url();
    if (!/googlevideo\.com\/videoplayback/.test(url)) return;
    const contentType = resp.headers()['content-type'] || getMimeFromUrl(url) || null;
    if (!firstMediaUrl) {
      firstMediaUrl = url;
      firstMediaContentType = contentType;
    }
    if (!isAudioCandidate(url, contentType)) return;
    capturedUrl = url;
    capturedContentType = contentType;
  });

  try {
    const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&autoplay=1&mute=1&playsinline=1`;
    await page.goto(ytUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const extracted = await page.evaluate(() => {
      const yip = window.ytInitialPlayerResponse || JSON.parse(window.ytplayer?.config?.args?.player_response || 'null');
      const details = yip?.videoDetails || {};
      const audioFormats = (yip?.streamingData?.adaptiveFormats || [])
        .filter((format) => typeof format.url === 'string' && /^audio\//i.test(format.mimeType || ''))
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
      return {
        metadata: {
          title: details.title || document.title || 'Unknown',
          artist: details.author || 'Unknown',
          duration: Number(details.lengthSeconds || 0),
        },
        audioFormat: audioFormats[0]
          ? {
              url: audioFormats[0].url,
              mimeType: audioFormats[0].mimeType || null,
            }
          : null,
      };
    }).catch(() => ({
      metadata: { title: 'Unknown', artist: 'Unknown', duration: 0 },
      audioFormat: null,
    }));

    if (extracted.audioFormat?.url) {
      capturedUrl = extracted.audioFormat.url;
      capturedContentType = extracted.audioFormat.mimeType || getMimeFromUrl(capturedUrl) || null;
    }

    for (let i = 0; i < 40 && !capturedUrl; i++) {
      await delay(500);
    }

    if (!capturedUrl) {
      const kind = firstMediaUrl
        ? `only captured non-audio media (${firstMediaContentType || getMimeFromUrl(firstMediaUrl) || 'unknown type'})`
        : 'no media request captured';
      console.warn(`[Extract] ${kind} for ${videoId}`);
      return null;
    }

    const info = {
      url: capturedUrl,
      mimeType: capturedContentType || 'application/octet-stream',
      duration: extracted.metadata.duration,
      title: extracted.metadata.title,
      artist: extracted.metadata.artist,
    };
    setCachedExtractedInfo(videoId, info);
    return info;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Audio Routes ───────────────────────────────────────────────────────
app.post('/rip', authorizeWorker, async (req, res) => {
  const { videoId } = req.body;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid videoId' });
  return res.status(410).json({ success: false, error: 'Legacy ripper disabled' });
});

app.get('/music/:videoId', authorizeWorker, (req, res) => {
  const { videoId } = req.params;
  if (!isValidVideoId(videoId)) return res.status(400).send('Invalid videoId');
  return res.status(410).send('Legacy music endpoint disabled');
});

app.get('/extract', authorizeWorker, async (req, res) => {
  const { videoId } = req.query;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid videoId' });
  try {
    const info = await extractAudioInfo(videoId);
    if (!info?.url) return res.status(503).json({ error: 'Browser extraction failed' });
    return res.json(info);
  } catch (err) {
    console.error(`[Extract] Browser capture failed for ${videoId}`, describeError(err));
    return res.status(503).json({ error: 'Browser extraction failed' });
  }
});

app.get('/stream', authorizeWorker, async (req, res) => {
  const { videoId } = req.query;
  if (!isValidVideoId(videoId)) return res.status(400).send('Invalid videoId');
  return res.status(503).send('Legacy stream endpoint disabled');
});

app.get('/cache-stats', authorizeWorker, (req, res) => {
  res.status(410).json({ error: 'Legacy cache stats disabled' });
});

// ══════════════════════════════════════════════════════════════════════════
// ── DJ Engine — Server-side LiveKit audio publishing via ffmpeg ──────────
// ══════════════════════════════════════════════════════════════════════════

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2; // 16-bit PCM = 2 bytes/sample
const LIVEKIT_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const liveKitFailuresByRoom = new Map();

function describeError(err) {
  if (!err) return { message: 'unknown error' };
  return {
    name: err.name,
    message: err.message || String(err),
    code: err.code,
    status: err.status,
    reason: err.reason,
    stack: err.stack,
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class DJSession {
  constructor(roomId) {
    this.roomId = roomId;
    this.startedAt = new Date();
    this.lkRoom = null;
    this.audioSource = null;
    this.localTrack = null;
    this.peer = null;
    this.peerAudioSource = null;
    this.peerAudioTrack = null;
    this.peerStream = null;
    this.peerConnections = [];
    this.peerFallback = false;
    this.ffmpegProcess = null;
    this.pollInterval = null;
    this.currentVideoId = null;
    this.stopped = false;
    this.playing = false;
    this.ready = false; // true once track is published and source can accept frames
  }

  async start() {
    console.log(`[DJ:${this.roomId}] Starting session...`);

    try {
      const recentFailure = liveKitFailuresByRoom.get(this.roomId);
      if (recentFailure && Date.now() - recentFailure.at < LIVEKIT_RETRY_COOLDOWN_MS) {
        console.warn(`[DJ:${this.roomId}] Skipping LiveKit attempt; recent failure is still cooling down`, recentFailure);
        throw new Error(`LiveKit cooldown active after prior failure: ${recentFailure.error?.message || 'unknown error'}`);
      }

      await this.startLiveKit();
      liveKitFailuresByRoom.delete(this.roomId);
      await this.patchRoom({ djActive: true, djStatus: 'DJ connected', peerFallback: false });
    } catch (err) {
      const errorDetails = describeError(err);
      liveKitFailuresByRoom.set(this.roomId, { at: Date.now(), error: errorDetails });
      console.warn(`[DJ:${this.roomId}] LiveKit failed, starting PeerJS fallback`, {
        roomId: this.roomId,
        livekitUrl: process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || null,
        error: errorDetails,
      });
      await this.startPeerFallback();
      await this.patchRoom({ djActive: true, djStatus: 'DJ connected via PeerJS fallback', peerFallback: true });
    }

    // Start polling room state for track changes
    this.startPolling();
  }

  async startLiveKit() {
    // Get LiveKit token from main app
    const token = await this.getLiveKitToken();
    if (!token) throw new Error('Failed to get LiveKit token');

    const livekitUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://hearmeout-6ntnbsdm.livekit.cloud';
    if (!livekitUrl) throw new Error('LIVEKIT_URL not configured. Set LIVEKIT_URL or NEXT_PUBLIC_LIVEKIT_URL');

    // Connect to LiveKit
    this.lkRoom = new Room();
    try {
      await this.lkRoom.connect(livekitUrl, token);
    } catch (err) {
      console.error(`[DJ:${this.roomId}] LiveKit connect failed`, {
        roomId: this.roomId,
        musicRoom: `${this.roomId}-music`,
        livekitUrl,
        error: describeError(err),
      });
      throw err;
    }
    console.log(`[DJ:${this.roomId}] Connected to LiveKit room: ${this.roomId}-music`);

    // Create audio source and publish track
    this.audioSource = new AudioSource(SAMPLE_RATE, CHANNELS);
    this.localTrack = LocalAudioTrack.createAudioTrack('dj-music', this.audioSource);
    await this.lkRoom.localParticipant.publishTrack(this.localTrack, new TrackPublishOptions({
      source: TrackSource.MICROPHONE,
    }));
    console.log(`[DJ:${this.roomId}] Audio track published`);

    // Wait for the track to be fully negotiated before sending frames
    await new Promise(r => setTimeout(r, 500));
    this.ready = true;
    await this.patchRoom({ djActive: true, peerFallback: false, djPeerId: null, djStatus: 'DJ connected (LiveKit)' });
    console.log(`[DJ:${this.roomId}] Audio source ready for frames`);
  }

  async startPeerFallback() {
    const basePeerId = `hmo-dj-${this.roomId}`;
    let lastError = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      const peerId = attempt === 1
        ? basePeerId
        : `${basePeerId}-${Date.now().toString(36)}-${attempt}`;
      this.cleanupPeerFallback();
      this.peerAudioSource = new wrtc.nonstandard.RTCAudioSource();
      this.peerAudioTrack = this.peerAudioSource.createTrack();
      this.peerStream = new wrtc.MediaStream([this.peerAudioTrack]);

      try {
        await new Promise((resolve, reject) => {
          let settled = false;
          this.peer = new Peer(peerId, { debug: 1 });

          this.peer.on('open', () => {
            settled = true;
            this.peerFallback = true;
            this.ready = true;
            console.log(`[DJ:${this.roomId}] PeerJS fallback ready as ${peerId}`);
            this.patchRoom({ djActive: true, peerFallback: true, djPeerId: peerId, djStatus: 'DJ connected (P2P)' }).catch(() => {});
            resolve();
          });

          this.peer.on('call', (call) => {
            console.log(`[DJ:${this.roomId}] PeerJS listener connected: ${call.peer}`);
            call.answer(this.peerStream);
            this.peerConnections.push(call);
            call.on('close', () => {
              this.peerConnections = this.peerConnections.filter(c => c !== call);
            });
          });

          this.peer.on('error', (err) => {
            console.error(`[DJ:${this.roomId}] PeerJS error:`, err.message);
            if (!settled) reject(err);
          });

          this.peer.on('disconnected', () => {
            if (this.peer && !this.peer.destroyed) this.peer.reconnect();
          });
        });
        return;
      } catch (err) {
        lastError = err;
        const message = err?.message || String(err);
        this.cleanupPeerFallback();
        if (!/taken|unavailable|already/i.test(message) || attempt === 4) break;
        const waitMs = attempt * 1500;
        console.warn(`[DJ:${this.roomId}] PeerJS ID ${peerId} is taken; retrying with a fresh ID in ${waitMs}ms`, { attempt, error: message });
        await delay(waitMs);
      }
    }

    throw lastError || new Error(`Could not start PeerJS fallback as ${basePeerId}`);
  }

  cleanupPeerFallback() {
    for (const conn of this.peerConnections) {
      try { conn.close(); } catch {}
    }
    this.peerConnections = [];
    try { this.peerAudioTrack?.stop(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
    this.peerAudioSource = null;
    this.peerAudioTrack = null;
    this.peerStream = null;
    this.peerFallback = false;
  }

  async getLiveKitToken() {
    try {
      const res = await fetch(`${APP_URL}/api/livekit-token`, {
        method: 'POST',
        headers: {
          ...WORKER_CALLBACK_HEADERS,
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
      const res = await fetch(`${APP_URL}/api/db?collection=rooms&id=${this.roomId}`, {
        headers: WORKER_CALLBACK_HEADERS,
      });
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
    if (this.stopped || !this.ready) return;

    // Try cached file first
    let filePath = join(CACHE_DIR, `${videoId}.m4a`);
    if (!existsSync(filePath)) filePath = join(CACHE_DIR, `${videoId}.mp3`);

    if (existsSync(filePath)) {
      console.log(`[DJ:${this.roomId}] Playing cached ${filePath}`);
      return this._playFile(filePath, roomData);
    }

    // Extract URL and stream directly (no download required)
    let audioInfo = getCachedExtractedInfo(videoId);
    if (!audioInfo) audioInfo = await extractAudioInfo(videoId);
    if (!audioInfo?.url) {
      console.error(`[DJ:${this.roomId}] Failed to extract URL for ${videoId}, skipping`);
      await this.patchRoom({ djStatus: 'Legacy extractor disabled' });
      setTimeout(() => this.advanceTrack(roomData), 500);
      return;
    }
    setCachedExtractedInfo(videoId, audioInfo);

    console.log(`[DJ:${this.roomId}] Streaming ${videoId} from URL`);
    this.playing = true;
    this._spawnFfmpeg(audioInfo.url, roomData);
  }

  _playFile(filePath, roomData) {
    this.playing = true;
    this._spawnFfmpeg(filePath, roomData);
  }

  _spawnFfmpeg(input, roomData) {
    this.ffmpegProcess = spawn('ffmpeg', [
      '-i', input,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-loglevel', 'error',
      'pipe:1',
    ]);

    let buffer = Buffer.alloc(0);
    let frameQueue = [];
    let draining = false;

    const drainQueue = async () => {
      if (draining) return;
      draining = true;
      while (frameQueue.length > 0 && !this.stopped && this.ready) {
        const samples = frameQueue.shift();
        try {
          await this.captureSamples(samples);
        } catch (err) {
          console.warn(`[DJ:${this.roomId}] captureFrame error (non-fatal):`, err.message);
          break;
        }
      }
      draining = false;
    };

    this.ffmpegProcess.stdout.on('data', (chunk) => {
      if (this.stopped || !this.ready) return;
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);
        const copied = Buffer.from(frameData);
        const samples = new Int16Array(copied.buffer, copied.byteOffset, copied.length / 2);
        frameQueue.push(samples);
      }
      drainQueue();
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

  async captureSamples(samples) {
    if (this.peerFallback) {
      if (!this.peerAudioSource) return;
      this.peerAudioSource.onData({
        samples,
        sampleRate: SAMPLE_RATE,
        bitsPerSample: 16,
        channelCount: CHANNELS,
        // samples is an Int16Array, so divide only by channels to get audio frames.
        numberOfFrames: samples.length / CHANNELS,
      });
      return;
    }

    if (!this.audioSource) return;
    const audioFrame = new AudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);
    await this.audioSource.captureFrame(audioFrame);
  }

  async waitReady() {
    // Wait up to 5s for the session to be ready
    for (let i = 0; i < 50 && !this.ready; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!this.ready) throw new Error('DJ session did not become ready in time');
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
      headers: {
        ...WORKER_CALLBACK_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId: this.roomId }),
    }).catch((err) => {
      console.warn(`[DJ:${this.roomId}] Auto-radio request failed:`, err.message);
    });
  }

  async patchRoom(data) {
    try {
      await fetch(`${APP_URL}/api/db`, {
        method: 'PATCH',
        headers: {
          ...WORKER_CALLBACK_HEADERS,
          'Content-Type': 'application/json',
        },
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

    this.cleanupPeerFallback();

    await this.patchRoom({ djActive: false, isPlaying: false, djStatus: 'DJ stopped', peerFallback: false, djPeerId: null });
    console.log(`[DJ:${this.roomId}] Session stopped`);
  }

  async playFromUrl(audioUrl, title) {
    this.stopPlayback();
    if (this.stopped) return;

    console.log(`[DJ:${this.roomId}] Playing from URL: ${title}`);
    this.playing = true;
    await this.patchRoom({ djStatus: `Playing: ${title}` });

    // Use ffmpeg to fetch the URL and decode to raw PCM
    this.ffmpegProcess = spawn('ffmpeg', [
      '-i', audioUrl,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-loglevel', 'error',
      'pipe:1',
    ]);

    let buffer = Buffer.alloc(0);
    let frameQueue = [];
    let draining = false;

    const drainQueue = async () => {
      if (draining) return;
      draining = true;
      while (frameQueue.length > 0 && !this.stopped && this.ready) {
        const samples = frameQueue.shift();
        try {
          await this.captureSamples(samples);
        } catch (err) {
          console.warn(`[DJ:${this.roomId}] captureFrame error (non-fatal):`, err.message);
          break;
        }
      }
      draining = false;
    };

    this.ffmpegProcess.stdout.on('data', (chunk) => {
      if (this.stopped || !this.ready) return;
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);
        const copied = Buffer.from(frameData);
        const samples = new Int16Array(copied.buffer, copied.byteOffset, copied.length / 2);
        frameQueue.push(samples);
      }
      drainQueue();
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
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error(`[DJ:${this.roomId}] ffmpeg error:`, err.message);
      this.playing = false;
      this.ffmpegProcess = null;
    });
  }
}

// ── Browser DJ Publisher ────────────────────────────────────────────────
const browserDjInstances = new Map();

async function startBrowserDJ(roomId) {
  const existing = browserDjInstances.get(roomId);
  if (existing) {
    try {
      const status = await existing.page.evaluate(() => globalThis.__HEARMEOUT_DJ__?.getStatus?.() || null);
      if (status?.isLive) {
        return { success: true, message: 'DJ already broadcasting.', mode: 'browser' };
      }
    } catch {}
    await stopBrowserDJ(roomId, 'Restarting stale browser DJ');
  }

  if (browserDjInstances.size >= 5) {
    return { success: false, message: 'Max concurrent DJ instances reached (5).' };
  }

  console.log(`[BrowserDJ:${roomId}] Launching Chromium publisher...`);
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
  page.on('console', (msg) => {
    const text = msg.text();
    if (/\[DJ\]|\[PeerDJ\]|\[MusicRoom\]|LiveKit|ERROR|error/i.test(text)) {
      console.log(`[BrowserDJ:${roomId}] ${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    console.error(`[BrowserDJ:${roomId}] page error:`, err.message);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (/livekit|peer|youtube-audio|\/api\/music|\/api\/db/.test(url)) {
      console.warn(`[BrowserDJ:${roomId}] request failed: ${url} ${req.failure()?.errorText || ''}`);
    }
  });

  const djUrl = `${APP_URL}/dj/${encodeURIComponent(roomId)}`;
  await page.goto(djUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!globalThis.__HEARMEOUT_DJ__, { timeout: 30000 });

  await page.evaluate(() => globalThis.__HEARMEOUT_DJ__.startSession());
  await page.waitForFunction(() => {
    const status = globalThis.__HEARMEOUT_DJ__?.getStatus?.();
    return status?.isLive || /^ERROR:/i.test(status?.status || '');
  }, { timeout: 60000 }).catch(() => {});

  const started = await page.evaluate(() => globalThis.__HEARMEOUT_DJ__.getStatus());
  if (!started?.isLive) {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    return {
      success: false,
      message: started?.status || 'DJ browser publisher did not become live.',
      mode: 'browser',
    };
  }

  browserDjInstances.set(roomId, { browser, page, roomId, startedAt: new Date() });
  console.log(`[BrowserDJ:${roomId}] Started`, started);
  return { success: true, message: started?.status || 'DJ browser publisher started.', mode: 'browser' };
}

async function stopBrowserDJ(roomId, reason = 'DJ stopped') {
  const instance = browserDjInstances.get(roomId);
  if (!instance) return { success: true, message: 'No DJ running.' };
  console.log(`[BrowserDJ:${roomId}] Stopping: ${reason}`);
  try {
    await instance.page.evaluate(() => globalThis.__HEARMEOUT_DJ__?.stopSession?.()).catch(() => {});
    await instance.page.close().catch(() => {});
    await instance.browser.close().catch(() => {});
  } finally {
    browserDjInstances.delete(roomId);
  }
  return { success: true, message: 'DJ stopped.' };
}

async function getBrowserDJStatus(roomId) {
  const instance = browserDjInstances.get(roomId);
  if (!instance) return null;
  try {
    const status = await instance.page.evaluate(() => globalThis.__HEARMEOUT_DJ__?.getStatus?.() || null);
    return { roomId, startedAt: instance.startedAt, mode: 'browser', status };
  } catch {
    return { roomId, startedAt: instance.startedAt, mode: 'browser', status: null };
  }
}

// ── DJ API ──────────────────────────────────────────────────────────────
const djInstances = new Map();

app.post('/dj', async (req, res) => {
  const { action, roomId, audioUrl, trackTitle } = req.body;
  if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });

  try {
    if (action === 'start') {
      try {
        const result = await startBrowserDJ(roomId);
        return res.status(result.success ? 200 : 429).json(result);
      } catch (err) {
        console.error(`[DJ:${roomId}] Start failed:`, err.message);
        return res.status(500).json({ success: false, message: `DJ start failed: ${err.message}` });
      }
    }

    if (action === 'play-url') {
      return res.status(410).json({ success: false, message: 'Legacy play-url action disabled' });
    }

    if (action === 'debug-play-url') {
      return res.status(410).json({ success: false, message: 'Legacy debug-play-url action disabled' });
    }


    if (action === 'stop') {
      await stopBrowserDJ(roomId);
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
  if (roomId) {
    const session = djInstances.get(roomId);
    const browserSession = browserDjInstances.get(roomId);
    return res.json({
      running: !!browserSession || !!session,
      mode: browserSession ? 'browser' : session?.peerFallback ? 'peerjs' : session ? 'livekit' : null,
    });
  }
  const browserInstances = Array.from(browserDjInstances.values()).map((s) => ({ roomId: s.roomId, startedAt: s.startedAt, mode: 'browser' }));
  const nodeInstances = Array.from(djInstances.entries()).map(([id, s]) => ({ roomId: id, startedAt: s.startedAt, mode: s.peerFallback ? 'peerjs' : 'livekit' }));
  const instances = [...browserInstances, ...nodeInstances];
  return res.json({ instances });
});

// ── Health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeDJs: djInstances.size + browserDjInstances.size });
});

// ── Prevent uncaught errors from crashing the process ───────────────────
process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught exception (non-fatal):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled rejection (non-fatal):', reason);
});

// ── Start ───────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DJ Worker] Server running on port ${PORT}`);
  console.log(`[DJ Worker] App URL: ${APP_URL}`);
  console.log(`[DJ Worker] Cache dir: ${CACHE_DIR}`);
  console.log('[DJ Worker] Legacy audio extraction: disabled');
});
