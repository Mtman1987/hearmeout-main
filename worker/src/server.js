const { resolve, join, dirname } = require('path');
const { tmpdir } = require('os');
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
const { timingSafeEqual } = require('crypto');
const { existsSync, mkdirSync, unlinkSync, statSync, readdirSync, readFileSync, writeFileSync, createReadStream, mkdtempSync, rmSync, openSync, readSync, closeSync, utimesSync } = require('fs');
let AudioSource, AudioFrame, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource;
try {
  ({ AudioSource, AudioFrame, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource } = require('@livekit/rtc-node'));
} catch (e) {
  console.warn('[DJ Worker] @livekit/rtc-node not available — LiveKit DJ engine disabled. Run `npm install` inside the worker/ directory to enable it.');
}
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
const {
  startVoiceBridge,
  stopVoiceBridge,
  setVoiceBridgeRoomOutbound,
  setVoiceBridgeAudioProfile,
  getVoiceBridgeStatus,
  listVoiceBridges,
} = require('./discord-voice-bridge');

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

const execFileAsync = promisify(execFile);

function redactSensitiveLogText(value) {
  return String(value || '')
    .replace(/([?&](?:access_token|refresh_token|id_token|token|api_key|key|signature|jwt)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
}

const app = express();
const PORT = process.env.PORT || 3002;
const APP_URL = process.env.APP_URL || 'https://hearmeout-main.fly.dev';
const WORKER_SHARED_SECRET = String(process.env.HMO_WORKER_SHARED_SECRET || '').trim();
const WORKER_CALLBACK_HEADERS = WORKER_SHARED_SECRET
  ? { Authorization: `Bearer ${WORKER_SHARED_SECRET}` }
  : {};
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
const WATCH_HLS_DIR = process.env.WATCH_HLS_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/watch-hls' : join(__dirname, '..', '.cache', 'watch-hls'));
const YOUTUBE_COOKIES_FILE =
  process.env.YTDLP_COOKIES_FILE ||
  process.env.YOUTUBE_COOKIES_FILE ||
  (process.env.NODE_ENV === 'production' ? '/data/youtube-cookies.txt' : join(rootDir, 'youtube-cookies.txt'));
const YOUTUBE_COOKIES_B64 = process.env.YTDLP_COOKIES_B64 || process.env.YOUTUBE_COOKIES_B64 || '';
const YTDLP_BGUTIL_SERVER_HOME = process.env.YTDLP_BGUTIL_SERVER_HOME || '';
const MUSIC_CATALOG_FILE = join(CACHE_DIR, 'search-index.json');
const DIRECT_VOD_CHUNK_BYTES = Number(process.env.DIRECT_VOD_CHUNK_BYTES || 8 * 1024 * 1024);
const WATCH_HLS_SEGMENT_SECONDS = Number(process.env.WATCH_HLS_SEGMENT_SECONDS || 6);
const WATCH_HLS_LIST_SIZE = Number(process.env.WATCH_HLS_LIST_SIZE || 90);
const WATCH_HLS_DELETE_THRESHOLD = Number(process.env.WATCH_HLS_DELETE_THRESHOLD || 12);
const WATCH_HLS_BUDGET_BYTES = Number(process.env.WATCH_HLS_BUDGET_BYTES || 1536 * 1024 * 1024);
const FLY_MACHINE_ID = process.env.FLY_MACHINE_ID || '';
const FLY_APP_NAME = process.env.FLY_APP_NAME || 'hmo-dj-worker';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const OFFLINE_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac']);
function isValidVideoId(id) {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

function youtubeWatchHlsId(videoId) {
  if (!isValidVideoId(videoId)) throw new Error('Invalid YouTube video id');
  return `yt-${videoId}`;
}

function offlineMusicId(relativePath) {
  return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function offlineMusicPathFromId(id) {
  const relativePath = Buffer.from(String(id || ''), 'base64url').toString('utf8');
  if (!relativePath || relativePath.includes('..') || resolve(CACHE_DIR, relativePath) === resolve(CACHE_DIR)) return null;
  const fullPath = resolve(CACHE_DIR, relativePath);
  const root = resolve(CACHE_DIR);
  if (fullPath !== root && !fullPath.startsWith(`${root}${require('path').sep}`)) return null;
  return { fullPath, relativePath };
}

function titleFromFileName(fileName) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function mimeForOfflineFile(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.opus')) return 'audio/opus';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'application/octet-stream';
}

function listOfflineMusicFiles(dir = CACHE_DIR, prefix = '') {
  if (!existsSync(dir)) return [];
  const items = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      items.push(...listOfflineMusicFiles(fullPath, relativePath));
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (!OFFLINE_AUDIO_EXTENSIONS.has(ext)) continue;
    const stats = statSync(fullPath);
    items.push({
      id: offlineMusicId(relativePath),
      title: titleFromFileName(entry.name),
      artist: prefix ? prefix.split('/').pop() || 'Offline Library' : 'Offline Library',
      duration: 180000,
      fileName: entry.name,
      relativePath,
      size: stats.size,
      playbackUrl: `/api/offline-music?id=${encodeURIComponent(offlineMusicId(relativePath))}`,
    });
  }
  return items;
}

function scoreOfflineTrack(track, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 1;
  const haystack = `${track.title} ${track.artist} ${track.relativePath}`.toLowerCase();
  if (haystack === needle) return 100;
  if (haystack.includes(needle)) return 80;
  return needle.split(/\s+/).filter(Boolean).reduce((score, word) => score + (haystack.includes(word) ? 10 : 0), 0);
}

function readMusicCatalog() {
  try {
    if (!existsSync(MUSIC_CATALOG_FILE)) return [];
    const payload = JSON.parse(readFileSync(MUSIC_CATALOG_FILE, 'utf8'));
    return Array.isArray(payload?.items) ? payload.items : [];
  } catch (err) {
    console.warn('[OfflineMusic] Could not read catalog:', err.message || err);
    return [];
  }
}

function writeMusicCatalog(items) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(MUSIC_CATALOG_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2));
}

function scoreCatalogTrack(track, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 1;
  const haystack = [
    track.title,
    track.artist,
    track.url,
    ...(Array.isArray(track.queries) ? track.queries : []),
  ].join(' ').toLowerCase();
  if (haystack === needle) return 100;
  if (haystack.includes(needle)) return 80;
  return needle.split(/\s+/).filter(Boolean).reduce((score, word) => score + (haystack.includes(word) ? 10 : 0), 0);
}

// ── Middleware ──────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

const authorizeWorker = (req, res, next) => {
  if (!WORKER_SHARED_SECRET) {
    console.error('[DJ Worker Auth] HMO_WORKER_SHARED_SECRET is required in production');
    return res.status(503).json({ error: 'Worker authentication is not configured' });
  }

  const authorization = String(req.get('authorization') || '');
  const suppliedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!secretsMatch(suppliedSecret, WORKER_SHARED_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

// ── Per-user client-uploaded music cache ───────────────────────────────
const USER_MUSIC_CACHE_LIMIT = Number(process.env.USER_MUSIC_CACHE_LIMIT || 25);
const USER_MUSIC_INDEX_FILE = join(CACHE_DIR, 'user-music-cache.json');

function cachedAudioFilePath(videoId) {
  const m4a = join(CACHE_DIR, `${videoId}.m4a`);
  if (existsSync(m4a)) return m4a;
  const mp3 = join(CACHE_DIR, `${videoId}.mp3`);
  if (existsSync(mp3)) return mp3;
  return null;
}

function cachedAudioContentType(filePath) {
  const header = Buffer.alloc(16);
  let descriptor;
  try {
    descriptor = openSync(filePath, 'r');
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
    if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
    if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
    if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  } catch {}
  finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
  return 'application/octet-stream';
}

function sanitizeUserId(value) {
  const clean = String(value || '').trim().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80);
  return clean || 'anonymous';
}

function readUserMusicIndex() {
  try {
    if (!existsSync(USER_MUSIC_INDEX_FILE)) return {};
    const parsed = JSON.parse(readFileSync(USER_MUSIC_INDEX_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeUserMusicIndex(index) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(USER_MUSIC_INDEX_FILE, JSON.stringify(index), 'utf8');
  } catch (err) {
    console.warn(`[Cache] Failed to persist user music index: ${err?.message || err}`);
  }
}

function isVideoReferenced(index, videoId) {
  return Object.values(index).some(
    (entries) => Array.isArray(entries) && entries.some((e) => e?.videoId === videoId),
  );
}

// Records a play (most-recent first), enforces the per-user limit, and deletes
// evicted files that no other user still references.
function recordUserMusicPlay(userId, videoId) {
  const user = sanitizeUserId(userId);
  const index = readUserMusicIndex();
  const prior = Array.isArray(index[user]) ? index[user].filter((e) => e?.videoId !== videoId) : [];
  const updated = [{ videoId, at: Date.now() }, ...prior];

  index[user] = updated.slice(0, USER_MUSIC_CACHE_LIMIT);
  const evicted = updated.slice(USER_MUSIC_CACHE_LIMIT);

  for (const entry of evicted) {
    if (!entry?.videoId || isVideoReferenced(index, entry.videoId)) continue;
    const filePath = cachedAudioFilePath(entry.videoId);
    if (filePath) {
      try { unlinkSync(filePath); } catch {}
    }
  }
  writeUserMusicIndex(index);
}

const urlCache = new Map();
let youtubeAuthRequiredUntil = 0;
function mediaCacheKey(videoId, mode = 'audio') {
  return `${mode}:${videoId}`;
}

function getCachedExtractedInfo(videoId, mode = 'audio') {
  const c = urlCache.get(mediaCacheKey(videoId, mode));
  if (c && c.expires > Date.now()) return c.info;
  urlCache.delete(mediaCacheKey(videoId, mode));
  return null;
}
function getCachedExtractedUrl(videoId) {
  return getCachedExtractedInfo(videoId, 'audio')?.url || null;
}

function capRangeHeader(rangeHeader) {
  const match = String(rangeHeader || '').match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) return rangeHeader || `bytes=0-${DIRECT_VOD_CHUNK_BYTES - 1}`;

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (!Number.isSafeInteger(start) || start < 0) return rangeHeader;

  const chunkEnd = start + DIRECT_VOD_CHUNK_BYTES - 1;
  const end = requestedEnd === null || requestedEnd > chunkEnd ? chunkEnd : requestedEnd;
  return `bytes=${start}-${end}`;
}
function setCachedExtractedInfo(videoId, info, mode = 'audio') {
  urlCache.set(mediaCacheKey(videoId, mode), { info, expires: Date.now() + 5 * 60 * 60 * 1000 });
}

let youtubeCookiesInitialized = false;
function ensureYoutubeCookiesFile() {
  if (youtubeCookiesInitialized) return;
  youtubeCookiesInitialized = true;
  if (!YOUTUBE_COOKIES_B64) return;
  try {
    mkdirSync(dirname(YOUTUBE_COOKIES_FILE), { recursive: true });
    writeFileSync(YOUTUBE_COOKIES_FILE, Buffer.from(YOUTUBE_COOKIES_B64, 'base64'), { mode: 0o600 });
    console.log(`[Extract] Wrote YouTube cookies file to ${YOUTUBE_COOKIES_FILE}`);
  } catch (err) {
    console.warn(`[Extract] Could not write YouTube cookies file: ${err?.message || err}`);
  }
}

function ytDlpCookieArgs() {
  ensureYoutubeCookiesFile();
  return existsSync(YOUTUBE_COOKIES_FILE) ? ['--cookies', YOUTUBE_COOKIES_FILE] : [];
}

function hasYoutubeCookies() {
  ensureYoutubeCookiesFile();
  return existsSync(YOUTUBE_COOKIES_FILE);
}

function markYoutubeAuthRequired(message) {
  if (hasYoutubeCookies()) return;
  youtubeAuthRequiredUntil = Date.now() + 5 * 60 * 1000;
  console.warn(`[Extract] YouTube auth required: ${String(message || '').slice(0, 220)}`);
}

function youtubeAuthRequiredError() {
  if (hasYoutubeCookies() || Date.now() > youtubeAuthRequiredUntil) return null;
  return new Error('YouTube auth required: add a Netscape cookies.txt file at /data/youtube-cookies.txt or set YOUTUBE_COOKIES_B64 as a Fly secret.');
}

function mimeFromYtDlpInfo(info, mode) {
  const ext = String(info?.ext || '').toLowerCase();
  if (mode === 'audio') {
    if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
    if (ext === 'webm') return 'audio/webm';
    if (ext === 'opus') return 'audio/opus';
    return getMimeFromUrl(info?.url || '') || 'audio/mp4';
  }
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  return getMimeFromUrl(info?.url || '') || 'video/mp4';
}

function extractYtDlpUrl(info) {
  if (typeof info?.url === 'string' && /^https?:\/\//i.test(info.url)) return info.url;
  const requested = Array.isArray(info?.requested_downloads) ? info.requested_downloads : [];
  for (const item of requested) {
    if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) return item.url;
  }
  return null;
}

async function extractWithYtDlp(videoId, mode = 'audio') {
  const format = mode === 'video'
    ? 'bestvideo[ext=mp4][height<=720][vcodec^=avc1]/bestvideo[ext=mp4][height<=720]/bestvideo[height<=720]/bestvideo'
    : 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio';
  const cookieArgs = ytDlpCookieArgs();
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--extractor-args',
    'youtube:player_client=mweb',
    ...(YTDLP_BGUTIL_SERVER_HOME
      ? ['--extractor-args', `youtubepot-bgutilscript:server_home=${YTDLP_BGUTIL_SERVER_HOME}`]
      : []),
    '--dump-json',
    '--format',
    format,
    ...cookieArgs,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  const parseResult = (stdout) => {
    const info = JSON.parse(stdout);
    const url = extractYtDlpUrl(info);
    if (!url) return null;
    return {
      url,
      mimeType: mimeFromYtDlpInfo(info, mode),
      duration: Number(info.duration || 0),
      title: info.title || 'Unknown',
      artist: info.uploader || info.channel || 'Unknown',
    };
  };

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 40000,
      maxBuffer: 12 * 1024 * 1024,
    });
    return parseResult(stdout);
  } catch (err) {
    const message = err?.stderr || err?.message || String(err);
    if (/sign in to confirm/i.test(String(message)) && cookieArgs.length) {
      try {
        const cookieIndex = args.indexOf('--cookies');
        const anonymousArgs = [...args.slice(0, cookieIndex), ...args.slice(cookieIndex + 2)];
        const { stdout } = await execFileAsync('yt-dlp', anonymousArgs, {
          timeout: 40000,
          maxBuffer: 12 * 1024 * 1024,
        });
        console.log(`[Extract] yt-dlp ${mode} recovered without stale cookies for ${videoId}`);
        return parseResult(stdout);
      } catch (anonymousErr) {
        const anonymousMessage = anonymousErr?.stderr || anonymousErr?.message || String(anonymousErr);
        console.warn(`[Extract] yt-dlp anonymous ${mode} retry failed for ${videoId}: ${String(anonymousMessage).slice(0, 220)}`);
      }
    }
    if (/sign in to confirm/i.test(String(message))) markYoutubeAuthRequired(message);
    console.warn(`[Extract] yt-dlp ${mode} lookup failed for ${videoId}: ${String(message).slice(0, 220)}`);
    return null;
  }
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

function isVideoCandidate(rawUrl, contentType) {
  const responseType = normalizeContentType(contentType);
  const queryType = normalizeContentType(getMimeFromUrl(rawUrl));
  return responseType.startsWith('video/') || queryType.startsWith('video/');
}

function createExtractorUserDataDir(mode, videoId) {
  const baseDir = EXTRACTOR_USER_DATA_DIR || join(tmpdir(), 'hmo-extractor');
  mkdirSync(baseDir, { recursive: true });
  return mkdtempSync(join(baseDir, `${mode}-${videoId}-`));
}

function cleanupExtractorUserDataDir(userDataDir) {
  if (!userDataDir) return;
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[Extract] Failed to clean Chromium profile ${userDataDir}: ${err.message?.slice(0, 120)}`);
  }
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

async function extractDirectVideoFormat(videoId) {
  const { Innertube, ClientType } = await import('youtubei.js');
  const clients = ['ANDROID_VR', 'ANDROID', 'IOS', 'TV', 'MWEB', 'WEB'];

  for (const client of clients) {
    try {
      const yt = await Innertube.create({ client_type: ClientType?.[client] || client });
      const info = await yt.getBasicInfo(videoId);
      const formats = [
        ...(info.streaming_data?.formats || []),
        ...(info.streaming_data?.adaptive_formats || []),
      ];
      const videoFormats = formats
        .filter((format) => {
          const mimeType = String(format.mime_type || format.mimeType || '');
          const hasVideo = format.has_video || format.width || format.height || mimeType.startsWith('video/');
          return mimeType.startsWith('video/') && hasVideo;
        })
        .sort((a, b) => {
          const aMime = String(a.mime_type || a.mimeType || '');
          const bMime = String(b.mime_type || b.mimeType || '');
          const aMp4 = aMime.includes('video/mp4') ? 1 : 0;
          const bMp4 = bMime.includes('video/mp4') ? 1 : 0;
          const aH264 = /avc1|h264/i.test(aMime) ? 1 : 0;
          const bH264 = /avc1|h264/i.test(bMime) ? 1 : 0;
          return (bMp4 - aMp4) || (bH264 - aH264) || ((Number(b.height) || 0) - (Number(a.height) || 0)) || ((Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
        });
      console.log(`[Extract] ${client} direct lookup returned ${videoFormats.length} video formats for ${videoId}`);

      for (const format of videoFormats) {
        let url = format.url;
        if (!url && typeof format.decipher === 'function') {
          url = await format.decipher(yt.session.player).catch(() => null);
        }
        if (!url) continue;
        return {
          url,
          mimeType: format.mime_type || format.mimeType || getMimeFromUrl(url) || 'video/mp4',
        };
      }
    } catch (err) {
      console.warn(`[Extract] ${client} direct video lookup failed: ${err.message?.slice(0, 120)}`);
    }
  }

  return null;
}

async function extractFromUpstream(videoId, mode = 'audio') {
  if (!UPSTREAM_EXTRACTOR_URL) return null;

  const endpoint = `${UPSTREAM_EXTRACTOR_URL}/extract?videoId=${encodeURIComponent(videoId)}&mode=${encodeURIComponent(mode)}`;
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

async function extractAudioInfo(videoId, forceRefresh = false) {
  const cached = forceRefresh ? null : getCachedExtractedInfo(videoId, 'audio');
  if (cached) return cached;

  const ytDlpInfo = await extractWithYtDlp(videoId, 'audio');
  if (ytDlpInfo?.url) {
    setCachedExtractedInfo(videoId, ytDlpInfo, 'audio');
    return ytDlpInfo;
  }
  const authError = youtubeAuthRequiredError();
  if (authError) throw authError;

  const upstreamInfo = await extractFromUpstream(videoId, 'audio');
  if (upstreamInfo?.url) {
    setCachedExtractedInfo(videoId, upstreamInfo, 'audio');
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
    setCachedExtractedInfo(videoId, info, 'audio');
    return info;
  }

  console.warn(`[Extract] Browser capture starting for ${videoId}`);
  const userDataDir = createExtractorUserDataDir('audio', videoId);
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    userDataDir,
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
  await page.setViewport({ width: 1280, height: 720 });
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
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) void video.play().catch(() => {});
    }).catch(() => {});

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
    setCachedExtractedInfo(videoId, info, 'audio');
    return info;
  } finally {
    await browser.close().catch(() => {});
    cleanupExtractorUserDataDir(userDataDir);
  }
}

async function extractVideoInfo(videoId, forceRefresh = false) {
  const cached = forceRefresh ? null : getCachedExtractedInfo(videoId, 'video');
  if (cached) return cached;

  const ytDlpInfo = await extractWithYtDlp(videoId, 'video');
  if (ytDlpInfo?.url) {
    setCachedExtractedInfo(videoId, ytDlpInfo, 'video');
    return ytDlpInfo;
  }
  const authError = youtubeAuthRequiredError();
  if (authError) throw authError;

  const upstreamInfo = await extractFromUpstream(videoId, 'video');
  if (upstreamInfo?.url) {
    setCachedExtractedInfo(videoId, upstreamInfo, 'video');
    return upstreamInfo;
  }

  const directVideo = await extractDirectVideoFormat(videoId);
  if (directVideo?.url) {
    const info = {
      url: directVideo.url,
      mimeType: directVideo.mimeType || 'video/mp4',
      duration: 0,
      title: 'Unknown',
      artist: 'Unknown',
    };
    setCachedExtractedInfo(videoId, info, 'video');
    return info;
  }

  console.warn(`[Extract] Browser video capture starting for ${videoId}`);
  const userDataDir = createExtractorUserDataDir('video', videoId);
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    userDataDir,
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
  await page.setViewport({ width: 1280, height: 720 });
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
    if (!isVideoCandidate(url, contentType)) return;
    capturedUrl = url;
    capturedContentType = contentType;
  });

  try {
    const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&autoplay=1&mute=1&playsinline=1`;
    await page.goto(ytUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) void video.play().catch(() => {});
    }).catch(() => {});

    const extracted = await page.evaluate(() => {
      const yip = window.ytInitialPlayerResponse || JSON.parse(window.ytplayer?.config?.args?.player_response || 'null');
      const details = yip?.videoDetails || {};
      const videoFormats = [
        ...(yip?.streamingData?.formats || []),
        ...(yip?.streamingData?.adaptiveFormats || []),
      ]
        .filter((format) => typeof format.url === 'string' && /^video\//i.test(format.mimeType || ''))
        .sort((a, b) => {
          const aMime = String(a.mimeType || '');
          const bMime = String(b.mimeType || '');
          const aMp4 = aMime.includes('video/mp4') ? 1 : 0;
          const bMp4 = bMime.includes('video/mp4') ? 1 : 0;
          const aH264 = /avc1|h264/i.test(aMime) ? 1 : 0;
          const bH264 = /avc1|h264/i.test(bMime) ? 1 : 0;
          return (bMp4 - aMp4) || (bH264 - aH264) || (Number(b.height) || 0) - (Number(a.height) || 0) || (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
        });
      return {
        metadata: {
          title: details.title || document.title || 'Unknown',
          artist: details.author || 'Unknown',
          duration: Number(details.lengthSeconds || 0),
        },
        videoFormat: videoFormats[0]
          ? {
              url: videoFormats[0].url,
              mimeType: videoFormats[0].mimeType || null,
            }
          : null,
      };
    }).catch(() => ({
      metadata: { title: 'Unknown', artist: 'Unknown', duration: 0 },
      videoFormat: null,
    }));

    if (extracted.videoFormat?.url) {
      capturedUrl = extracted.videoFormat.url;
      capturedContentType = extracted.videoFormat.mimeType || getMimeFromUrl(capturedUrl) || null;
    }

    for (let i = 0; i < 40 && !capturedUrl; i++) {
      await delay(500);
    }

    if (!capturedUrl) {
      const kind = firstMediaUrl
        ? `only captured non-video media (${firstMediaContentType || getMimeFromUrl(firstMediaUrl) || 'unknown type'})`
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
    setCachedExtractedInfo(videoId, info, 'video');
    return info;
  } finally {
    await browser.close().catch(() => {});
    cleanupExtractorUserDataDir(userDataDir);
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
  const mode = String(req.query.mode || 'audio').toLowerCase() === 'video' ? 'video' : 'audio';
  const forceRefresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid videoId' });
  try {
    const info = mode === 'video' ? await extractVideoInfo(videoId, forceRefresh) : await extractAudioInfo(videoId, forceRefresh);
    if (!info?.url) return res.status(503).json({ error: 'Browser extraction failed' });
    return res.json({ ...info, mode });
  } catch (err) {
    console.error(`[Extract] Browser capture failed for ${videoId}`, describeError(err));
    return res.status(503).json({ error: 'Browser extraction failed' });
  }
});

app.get('/offline-music', authorizeWorker, (req, res) => {
  try {
    const query = String(req.query.query || '');
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
    const items = listOfflineMusicFiles()
      .map((item) => ({ item, score: scoreOfflineTrack(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
      .slice(0, limit)
      .map(({ item }) => item);
    res.json({ items, cacheDir: CACHE_DIR });
  } catch (err) {
    console.error('[OfflineMusic] List failed:', err.message || err);
    res.status(500).json({ error: 'Offline music list failed' });
  }
});

app.get('/offline-music/catalog', authorizeWorker, (req, res) => {
  try {
    const query = String(req.query.query || '');
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
    const items = readMusicCatalog()
      .map((item) => ({ item, score: scoreCatalogTrack(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || String(left.item.title || '').localeCompare(String(right.item.title || '')))
      .slice(0, limit)
      .map(({ item }) => item);
    res.json({ items, catalogFile: MUSIC_CATALOG_FILE });
  } catch (err) {
    console.error('[OfflineMusic] Catalog list failed:', err.message || err);
    res.status(500).json({ error: 'Music catalog list failed' });
  }
});

app.post('/offline-music/catalog', authorizeWorker, (req, res) => {
  try {
    const track = req.body?.track || {};
    const id = String(track.id || '').trim();
    const url = String(track.url || '').trim();
    if (!id || !url) return res.status(400).json({ error: 'Missing track id or url' });

    const query = String(req.body?.query || '').trim();
    const now = new Date().toISOString();
    const items = readMusicCatalog();
    const existingIndex = items.findIndex((item) => String(item.id || '') === id);
    const existing = existingIndex >= 0 ? items[existingIndex] : {};
    const queries = new Set([...(Array.isArray(existing.queries) ? existing.queries : [])]);
    if (query) queries.add(query);

    const next = {
      ...existing,
      id,
      title: String(track.title || existing.title || id),
      artist: String(track.artist || existing.artist || 'Unknown Artist'),
      url,
      thumbnail: track.thumbnail || existing.thumbnail || '',
      duration: Number(track.duration || existing.duration || 180000),
      queries: Array.from(queries).slice(-20),
      savedAt: existing.savedAt || now,
      updatedAt: now,
    };

    if (existingIndex >= 0) items.splice(existingIndex, 1);
    items.unshift(next);
    writeMusicCatalog(items.slice(0, 1000));
    res.json({ item: next, count: Math.min(items.length, 1000), catalogFile: MUSIC_CATALOG_FILE });
  } catch (err) {
    console.error('[OfflineMusic] Catalog save failed:', err.message || err);
    res.status(500).json({ error: 'Music catalog save failed' });
  }
});

app.delete('/offline-music/catalog', authorizeWorker, (req, res) => {
  try {
    const id = String(req.query.id || req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing track id' });
    const items = readMusicCatalog();
    const nextItems = items.filter((item) => String(item.id || '') !== id);
    writeMusicCatalog(nextItems);
    res.json({ removed: items.length - nextItems.length, count: nextItems.length, catalogFile: MUSIC_CATALOG_FILE });
  } catch (err) {
    console.error('[OfflineMusic] Catalog delete failed:', err.message || err);
    res.status(500).json({ error: 'Music catalog delete failed' });
  }
});

app.get('/offline-music/stream', authorizeWorker, (req, res) => {
  try {
    const resolved = offlineMusicPathFromId(req.query.id);
    if (!resolved || !existsSync(resolved.fullPath)) return res.status(404).send('Offline song not found');
    const stats = statSync(resolved.fullPath);
    if (!stats.isFile()) return res.status(404).send('Offline song not found');

    const range = req.headers.range;
    const contentType = mimeForOfflineFile(resolved.fullPath);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', contentType);

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
      if (!match) return res.status(416).send('Invalid range');
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : stats.size - 1;
      if (!Number.isSafeInteger(start) || start < 0 || start >= stats.size) {
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        return res.status(416).send('Range not satisfiable');
      }
      const end = Math.min(requestedEnd, stats.size - 1);
      res.status(206);
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      return createReadStream(resolved.fullPath, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', String(stats.size));
    createReadStream(resolved.fullPath).pipe(res);
  } catch (err) {
    console.error('[OfflineMusic] Stream failed:', err.message || err);
    if (!res.headersSent) res.status(500).send('Offline song stream failed');
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

// All public player views use these two producer slots. Legacy extraction
// functions remain available to the resolver, never one player per room.
const { SharedMediaRelay } = require('./shared-media-relay');
const { selectSharedAudioStream } = require('./shared-source-audio');
const sharedMediaRelay = new SharedMediaRelay({
  root: join(WATCH_HLS_DIR, 'shared'),
  validateSource: async (kind, requestId) => {
    const response = await fetch(`${APP_URL}/api/watch/source?kind=${kind}&requestId=${encodeURIComponent(requestId)}`, {
      headers: WORKER_CALLBACK_HEADERS, signal: AbortSignal.timeout(15000),
    });
    return response.ok;
  },
  resolveSource: async (kind, requestId) => {
    const sourceEndpoint = `${APP_URL}/api/watch/source?kind=${kind}&requestId=${encodeURIComponent(requestId)}`;
    const fetchSource = async () => {
      const response = await fetch(sourceEndpoint, { headers: WORKER_CALLBACK_HEADERS, signal: AbortSignal.timeout(15000) });
      return response.ok ? response.json() : null;
    };
    const source = await fetchSource();
    if (!source) return null;
    let inputs;
    let video = true;
    let audioInput = 0;
    let audioStreamIndex = null;
    if (source.provider === 'youtube') {
      const cached = cachedAudioFilePath(source.videoId);
      if (cached) { inputs = [{ url: cached }]; video = false; }
      else {
        const visual = await extractVideoInfo(source.videoId);
        const audio = await extractAudioInfo(source.videoId);
        if (!visual?.url || !audio?.url) throw new Error('YouTube source unavailable');
        inputs = [{ url: visual.url }, { url: audio.url }]; audioInput = 1;
      }
    } else {
      const local = new URL(source.sourceUrl).origin === new URL(APP_URL).origin;
      inputs = [{ url: source.sourceUrl, ...(local && WORKER_SHARED_SECRET ? { headers: `Authorization: Bearer ${WORKER_SHARED_SECRET}\r\n` } : {}) }];
      video = kind === 'movie';
      if (video) {
        // Probe one source before opening the relay, never one per viewer.
        const probeArgs = ['-v', 'error', '-show_streams', '-of', 'json'];
        if (inputs[0].headers) probeArgs.push('-headers', inputs[0].headers);
        probeArgs.push(inputs[0].url);
        try {
          const { stdout } = await execFileAsync('ffprobe', probeArgs, { timeout: 20000, maxBuffer: 1024 * 1024 });
          audioStreamIndex = selectSharedAudioStream(JSON.parse(stdout).streams || []);
        } catch (_) { /* Fall back to the first audio stream if probing fails. */ }
      }
    }
    if (!await fetchSource()) return null;
    return { inputs, video, audioInput, audioStreamIndex };
  },
  onEnded: async (kind, requestId, error) => {
    const response = await fetch(`${APP_URL}/api/watch/source-ended`, {
      method: 'POST', headers: { ...WORKER_CALLBACK_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ kind, requestId, failed: Boolean(error) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Completion callback failed: ${response.status}`);
  },
});
// Recover the same authoritative source after worker/app restarts, even if
// no browser is open. Listener arrival/departure never owns its lifecycle.
let reconcilingSharedMedia = false;
async function reconcileSharedMedia() {
  if (reconcilingSharedMedia) return;
  reconcilingSharedMedia = true;
  try {
    for (const [kind, sessionId] of [['movie', 'discord-watch-room'], ['music', 'discord-music-room']]) {
      try {
        const response = await fetch(`${APP_URL}/api/watch/sessions/${sessionId}/state`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) continue;
        const state = await response.json();
        if (state.current?.requestId) await sharedMediaRelay.ensure(kind, state.current.requestId);
      } catch (_) { /* Retry on the next pass; never start a fallback producer. */ }
    }
  } finally { reconcilingSharedMedia = false; }
}
setInterval(reconcileSharedMedia, 10000).unref();
void reconcileSharedMedia();

app.get('/shared-media/:kind/:file', authorizeWorker, async (req, res) => {
  const { kind, file } = req.params;
  const requestId = String(req.query.requestId || '');
  try {
    let media = await sharedMediaRelay.file(kind, requestId, file);
    const deadline = Date.now() + 45000;
    while (!media && file === 'index.m3u8' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      media = await sharedMediaRelay.file(kind, requestId, file);
    }
    if (!media) return res.status(file === 'index.m3u8' ? 503 : 404).json({ error: 'Shared stream is preparing' });
    res.setHeader('content-type', media.contentType);
    res.setHeader('cache-control', 'no-store');
    createReadStream(media.path).on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
  } catch (_) { res.status(503).json({ error: 'Shared source unavailable' }); }
});

app.get('/watch/youtube/cache/:videoId/stream', authorizeWorker, (req, res) => {
  try {
    const videoId = String(req.params.videoId || '');
    if (!isValidVideoId(videoId)) return res.status(400).send('Invalid YouTube video id');
    const filePath = cachedAudioFilePath(videoId);
    if (!filePath) return res.status(404).send('Cached audio not found');
    const stats = statSync(filePath);
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', cachedAudioContentType(filePath));

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
      if (!match) return res.status(416).send('Invalid range');
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : stats.size - 1;
      if (!Number.isSafeInteger(start) || start < 0 || start >= stats.size) {
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        return res.status(416).send('Range not satisfiable');
      }
      const end = Math.min(requestedEnd, stats.size - 1);
      res.status(206);
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      return createReadStream(filePath, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', String(stats.size));
    return createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[Cache] Stream failed:', err?.message || err);
    if (!res.headersSent) return res.status(500).send('Cached audio stream failed');
  }
});

app.get('/watch/youtube/cache/:videoId', authorizeWorker, (req, res) => {
  const videoId = String(req.params.videoId || '');
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid YouTube video id' });
  const filePath = cachedAudioFilePath(videoId);
  if (!filePath) return res.status(404).json({ cached: false });
  if (req.query.user) recordUserMusicPlay(req.query.user, videoId);
  return res.json({ cached: true, videoId, bytes: statSync(filePath).size });
});

// Store audio bytes the browser downloaded (from the user's IP/session) so
// playback can stream a local file instead of extracting from YouTube.
app.post(
  '/watch/youtube/cache/:videoId',
  express.raw({ type: () => true, limit: '75mb' }),
  authorizeWorker,
  (req, res) => {
    try {
      const videoId = String(req.params.videoId || '');
      if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid YouTube video id' });

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: 'Empty audio body' });
      }

      mkdirSync(CACHE_DIR, { recursive: true });
      const filePath = join(CACHE_DIR, `${videoId}.m4a`);
      writeFileSync(filePath, body);
      recordUserMusicPlay(req.query.user, videoId);

      console.log(`[Cache] Stored client-uploaded audio for ${videoId} (${body.length} bytes)`);
      return res.json({ ok: true, videoId, bytes: body.length });
    } catch (err) {
      return res.status(500).json({ error: err?.message || 'Failed to cache audio' });
    }
  },
);

// Retired per-item producers and direct-provider playback cannot fork the
// shared source, including calls from cached clients.
for (const path of ['/watch/youtube/hls/:videoId/:file', '/watch/xtream/hls/:streamId/:file', '/watch/xtream/direct/:kind/:streamId']) {
  app.get(path, authorizeWorker, (_req, res) => res.status(410).json({ error: 'Reopen the shared player.' }));
}
app.get('/watch/cache/status', authorizeWorker, (_req, res) => res.json({ sharedMedia: sharedMediaRelay.snapshot() }));
app.post('/watch/cache/control', authorizeWorker, (_req, res) => res.status(410).json({ error: 'Playback controls are unavailable.' }));

// Legacy DJ routes describe the one music source; they never spawn Chromium
// or a room-specific decoder. Voice/persona publishing stays independent.
app.get('/dj', authorizeWorker, (_req, res) => {
  const music = sharedMediaRelay.snapshot().find(source => source.kind === 'music');
  res.json({ running: Boolean(music?.producing), mode: 'shared', instances: [] });
});
app.post('/dj', authorizeWorker, (_req, res) => res.status(410).json({ success: false, message: 'Playback controls are temporarily unavailable.' }));

// ── Discord voice bridge ────────────────────────────────────────────────
const BRIDGE_LIVEKIT_URL =
  process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || '';

// The bot token lives on the main app. Rather than duplicating the secret on
// the worker, fetch it over the existing internal worker channel. Falls back to
// a local env var if one is set. Cached after first successful fetch.
let cachedBotToken = process.env.DISCORD_BOT_TOKEN || '';
async function resolveDiscordBotToken() {
  if (cachedBotToken) return cachedBotToken;
  const res = await fetch(`${APP_URL}/api/discord/bot-token`, { headers: WORKER_CALLBACK_HEADERS });
  if (!res.ok) throw new Error(`Could not fetch Discord bot token from app (${res.status})`);
  const { token } = await res.json();
  if (!token) throw new Error('App returned no Discord bot token');
  cachedBotToken = token;
  return cachedBotToken;
}

app.post('/voice-bridge', authorizeWorker, async (req, res) => {
  const { action, roomId, guildId, voiceChannelId, audioProfile } = req.body || {};
  if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });

  try {
    if (action === 'start') {
      if (!BRIDGE_LIVEKIT_URL) {
        return res.status(500).json({ success: false, message: 'LIVEKIT_URL/NEXT_PUBLIC_LIVEKIT_URL is not configured on the worker' });
      }
      if (!guildId || !voiceChannelId) {
        return res.status(400).json({ success: false, message: 'Missing guildId or voiceChannelId' });
      }
      const token = await resolveDiscordBotToken();
      const result = await startVoiceBridge({
        roomId,
        guildId,
        voiceChannelId,
        token,
        appUrl: APP_URL,
        workerHeaders: WORKER_CALLBACK_HEADERS,
        livekitUrl: BRIDGE_LIVEKIT_URL,
        audioProfile,
      });
      return res.json(result);
    }

    if (action === 'stop') {
      const result = await stopVoiceBridge(roomId);
      return res.json(result);
    }

    return res.status(400).json({ success: false, message: 'Invalid action' });
  } catch (err) {
    console.error(`[VoiceBridge] ${action} failed for ${roomId}:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/voice-bridge', authorizeWorker, (req, res) => {
  const { roomId } = req.query;
  if (roomId) return res.json(getVoiceBridgeStatus(roomId));
  return res.json({ instances: listVoiceBridges() });
});

app.post('/voice-bridge/gate', authorizeWorker, (req, res) => {
  const { roomId, roomVoiceOutboundEnabled } = req.body || {};
  if (!roomId || typeof roomVoiceOutboundEnabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Missing roomId or boolean roomVoiceOutboundEnabled' });
  }
  return res.json(setVoiceBridgeRoomOutbound(roomId, roomVoiceOutboundEnabled));
});

app.post('/voice-bridge/audio-profile', authorizeWorker, (req, res) => {
  const { roomId, audioProfile } = req.body || {};
  if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });
  return res.json(setVoiceBridgeAudioProfile(roomId, audioProfile));
});

// ── Health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeDJs: 0, sharedMedia: sharedMediaRelay.snapshot() });
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
