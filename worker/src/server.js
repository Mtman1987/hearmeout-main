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
const { existsSync, mkdirSync, unlinkSync, statSync, readdirSync, readFileSync, writeFileSync, createReadStream, mkdtempSync, rmSync, openSync, readSync, closeSync } = require('fs');
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
const {
  startVoiceBridge,
  stopVoiceBridge,
  getVoiceBridgeStatus,
  listVoiceBridges,
} = require('./discord-voice-bridge');

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

// ── Watch HLS Transcoder ────────────────────────────────────────────────
const watchHlsJobs = new Map();
const watchHlsFailures = new Map();
const WATCH_HLS_FAILURE_TTL_MS = 2 * 60 * 1000;

function cleanWatchStreamId(streamId) {
  const raw = String(streamId || '').trim();
  const youtubeMatch = raw.match(/^yt-([A-Za-z0-9_-]{11})$/) || raw.match(/^youtube-([A-Za-z0-9_-]{11})$/);
  if (youtubeMatch) return youtubeWatchHlsId(youtubeMatch[1]);
  const clean = raw.replace(/[^0-9]/g, '');
  if (!clean) throw new Error('Invalid stream id');
  return clean;
}

function cleanHlsFileName(fileName) {
  const clean = String(fileName || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!clean || clean.includes('..')) throw new Error('Invalid HLS file');
  return clean;
}

function cleanFlyMachineId(machineId) {
  const clean = String(machineId || '').replace(/[^a-zA-Z0-9]/g, '');
  return clean || null;
}

function watchHlsPaths(streamId) {
  const clean = cleanWatchStreamId(streamId);
  const dir = join(WATCH_HLS_DIR, clean);
  return {
    clean,
    dir,
    indexPath: join(dir, 'index.m3u8'),
  };
}

function hasUsableWatchHlsIndex(dir, indexPath) {
  if (!existsSync(indexPath)) return false;
  const indexStats = statSync(indexPath);
  if (!indexStats.isFile() || indexStats.size <= 0) return false;

  const manifest = readFileSync(indexPath, 'utf8');
  if (manifest.includes('#EXT-X-PLAYLIST-TYPE:EVENT')) {
    try { unlinkSync(indexPath); } catch {}
    return false;
  }

  const firstSegment = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!firstSegment) return false;

  const segmentPath = join(dir, cleanHlsFileName(firstSegment));
  if (!existsSync(segmentPath)) return false;
  const segmentStats = statSync(segmentPath);
  return segmentStats.isFile() && segmentStats.size > 0;
}

function pinManifestSegmentsToMachine(manifest) {
  if (!FLY_MACHINE_ID) return manifest;
  const machineParam = `machine=${encodeURIComponent(FLY_MACHINE_ID)}`;
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || /[?&]machine=/.test(trimmed)) return line;
      return `${line}${line.includes('?') ? '&' : '?'}${machineParam}`;
    })
    .join('\n');
}

function pruneWatchHlsRoot() {
  if (!Number.isFinite(WATCH_HLS_BUDGET_BYTES) || WATCH_HLS_BUDGET_BYTES <= 0) return;
  mkdirSync(WATCH_HLS_DIR, { recursive: true });

  const dirs = [];
  for (const entry of readdirSync(WATCH_HLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(WATCH_HLS_DIR, entry.name);
    let size = 0;
    let mtimeMs = 0;
    for (const name of readdirSync(dir)) {
      const filePath = join(dir, name);
      let stats;
      try { stats = statSync(filePath); } catch { continue; }
      if (!stats.isFile()) continue;
      size += stats.size;
      mtimeMs = Math.max(mtimeMs, stats.mtimeMs);
    }
    dirs.push({ dir, size, mtimeMs });
  }

  let total = dirs.reduce((sum, dir) => sum + dir.size, 0);
  for (const hlsDir of dirs.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (total <= WATCH_HLS_BUDGET_BYTES) break;
    try {
      rmSync(hlsDir.dir, { recursive: true, force: true });
      total -= hlsDir.size;
    } catch {}
  }
}

function waitForWatchHlsIndex(streamId, timeoutMs = 45000) {
  const { dir, indexPath } = watchHlsPaths(streamId);
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (hasUsableWatchHlsIndex(dir, indexPath)) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
  });
}

function waitForWatchHlsFile(streamId, fileName, timeoutMs = 10000) {
  const { dir } = watchHlsPaths(streamId);
  const filePath = join(dir, cleanHlsFileName(fileName));
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        clearInterval(timer);
        resolve(filePath);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 250);
  });
}

function ensureWatchHls(streamId, sourceUrl) {
  const { clean, dir, indexPath } = watchHlsPaths(streamId);
  if (hasUsableWatchHlsIndex(dir, indexPath)) return Promise.resolve();
  if (watchHlsJobs.has(clean)) return watchHlsJobs.get(clean);
  if (!sourceUrl) return Promise.reject(new Error('Missing source URL for HLS conversion'));

  mkdirSync(dir, { recursive: true });
  pruneWatchHlsRoot();
  try { if (existsSync(indexPath)) unlinkSync(indexPath); } catch {}

  const promise = runWatchHlsFfmpeg(clean, sourceUrl, dir, indexPath)
    .catch((error) => {
      console.error(`[WatchHLS] Conversion failed for VOD ${clean}:`, error.message || error);
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      throw error;
    })
    .finally(() => {
      watchHlsJobs.delete(clean);
    });

  watchHlsJobs.set(clean, promise);
  return promise;
}

function ensureYoutubeWatchHls(videoId, clientResolved = null) {
  if (!isValidVideoId(videoId)) return Promise.reject(new Error('Invalid YouTube video id'));
  const streamId = youtubeWatchHlsId(videoId);
  const { clean, dir, indexPath } = watchHlsPaths(streamId);
  if (hasUsableWatchHlsIndex(dir, indexPath)) return Promise.resolve();
  if (watchHlsJobs.has(clean)) return watchHlsJobs.get(clean);
  watchHlsFailures.delete(clean);
  const clientVideoUrl = String(clientResolved?.videoUrl || '');
  const clientAudioUrl = String(clientResolved?.audioUrl || '');
  const hasClientResolvedStreams = Boolean(clientVideoUrl && clientAudioUrl);

  mkdirSync(dir, { recursive: true });
  pruneWatchHlsRoot();
  try { if (existsSync(indexPath)) unlinkSync(indexPath); } catch {}

  const promise = (async () => {
    const cachedAudio = cachedAudioFilePath(videoId);
    if (cachedAudio) {
      console.log(`[WatchHLS] Using cached audio file for ${clean}`);
      await runYoutubeAudioHlsFromFile(clean, cachedAudio, dir, indexPath);
      return;
    }

    if (hasClientResolvedStreams) {
      console.log(`[WatchHLS] Using client-resolved YouTube streams for ${clean}`);
      await runYoutubeHlsFfmpeg(clean, clientVideoUrl, clientAudioUrl, dir, indexPath);
      return;
    }

    const [videoInfo, audioInfo] = await Promise.all([
      extractVideoInfo(videoId),
      extractAudioInfo(videoId),
    ]);

    if (!videoInfo?.url) throw new Error('No YouTube video stream resolved');
    if (!audioInfo?.url) throw new Error('No YouTube audio stream resolved');
    await runYoutubeHlsFfmpeg(clean, videoInfo.url, audioInfo.url, dir, indexPath);
  })()
    .catch((error) => {
      console.error(`[WatchHLS] YouTube conversion failed for ${clean}:`, error.message || error);
      watchHlsFailures.set(clean, { at: Date.now(), message: error?.message || String(error) || 'YouTube HLS conversion failed' });
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      throw error;
    })
    .finally(() => {
      watchHlsJobs.delete(clean);
    });

  watchHlsJobs.set(clean, promise);
  return promise;
}

function getRecentWatchHlsFailure(streamId) {
  const clean = cleanWatchStreamId(streamId);
  const failure = watchHlsFailures.get(clean);
  if (!failure) return null;
  if (Date.now() - failure.at > WATCH_HLS_FAILURE_TTL_MS) {
    watchHlsFailures.delete(clean);
    return null;
  }
  return failure;
}

try {
  pruneWatchHlsRoot();
} catch (error) {
  console.error('[WatchHLS] Startup prune failed:', error?.message || error);
}

function runWatchHlsFfmpeg(streamId, sourceUrl, dir, indexPath) {
  const segmentPattern = join(dir, 'seg_%05d.ts');
  console.log(`[WatchHLS] Starting HLS conversion for VOD ${streamId}`);

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-threads', '2',
      '-y',
      '-user_agent', 'DiscordStreamHub/1.0',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_delay_max', '5',
      '-i', sourceUrl,
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-ac', '2',
      '-f', 'hls',
      '-hls_time', String(WATCH_HLS_SEGMENT_SECONDS),
      '-hls_list_size', String(WATCH_HLS_LIST_SIZE),
      ...(WATCH_HLS_LIST_SIZE > 0 ? ['-hls_delete_threshold', String(WATCH_HLS_DELETE_THRESHOLD)] : []),
      '-hls_flags', WATCH_HLS_LIST_SIZE > 0 ? 'delete_segments+independent_segments' : 'independent_segments',
      '-hls_segment_filename', segmentPattern,
      indexPath,
    ];

    const command = process.platform === 'win32' ? 'ffmpeg' : 'nice';
    const args = process.platform === 'win32' ? ffmpegArgs : ['-n', '10', 'ffmpeg', ...ffmpegArgs];
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });
}

function runYoutubeHlsFfmpeg(streamId, videoUrl, audioUrl, dir, indexPath) {
  const segmentPattern = join(dir, 'seg_%05d.ts');
  const youtubeHeaders = 'Referer: https://www.youtube.com/\r\nOrigin: https://www.youtube.com\r\n';
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const inputArgs = (url) => [
    '-user_agent', userAgent,
    '-headers', youtubeHeaders,
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_delay_max', '5',
    '-i', url,
  ];
  console.log(`[WatchHLS] Starting YouTube HLS conversion for ${streamId}`);

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-threads', '2',
      '-y',
      ...inputArgs(videoUrl),
      ...inputArgs(audioUrl),
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ac', '2',
      '-shortest',
      '-f', 'hls',
      '-hls_time', String(WATCH_HLS_SEGMENT_SECONDS),
      '-hls_list_size', String(WATCH_HLS_LIST_SIZE),
      ...(WATCH_HLS_LIST_SIZE > 0 ? ['-hls_delete_threshold', String(WATCH_HLS_DELETE_THRESHOLD)] : []),
      '-hls_flags', WATCH_HLS_LIST_SIZE > 0 ? 'delete_segments+independent_segments' : 'independent_segments',
      '-hls_segment_filename', segmentPattern,
      indexPath,
    ];

    const command = process.platform === 'win32' ? 'ffmpeg' : 'nice';
    const args = process.platform === 'win32' ? ffmpegArgs : ['-n', '10', 'ffmpeg', ...ffmpegArgs];
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });
}

// Builds an audio-only HLS ladder from a locally cached file (no network).
function runYoutubeAudioHlsFromFile(streamId, filePath, dir, indexPath) {
  const segmentPattern = join(dir, 'seg_%05d.ts');
  console.log(`[WatchHLS] Starting cached-audio HLS conversion for ${streamId}`);

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-threads', '2',
      '-y',
      '-i', filePath,
      '-vn',
      '-map', '0:a:0',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ac', '2',
      '-f', 'hls',
      '-hls_time', String(WATCH_HLS_SEGMENT_SECONDS),
      '-hls_list_size', String(WATCH_HLS_LIST_SIZE),
      ...(WATCH_HLS_LIST_SIZE > 0 ? ['-hls_delete_threshold', String(WATCH_HLS_DELETE_THRESHOLD)] : []),
      '-hls_flags', WATCH_HLS_LIST_SIZE > 0 ? 'delete_segments+independent_segments' : 'independent_segments',
      '-hls_segment_filename', segmentPattern,
      indexPath,
    ];

    const command = process.platform === 'win32' ? 'ffmpeg' : 'nice';
    const args = process.platform === 'win32' ? ffmpegArgs : ['-n', '10', 'ffmpeg', ...ffmpegArgs];
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });
}

app.get('/watch/youtube/hls/:videoId/:file', authorizeWorker, async (req, res) => {
  try {
    const videoId = String(req.params.videoId || '');
    if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid YouTube video id' });
    const file = cleanHlsFileName(req.params.file);
    const requestedMachine = cleanFlyMachineId(req.query.machine);
    if (requestedMachine && FLY_MACHINE_ID && requestedMachine !== FLY_MACHINE_ID) {
      res.setHeader('fly-replay', `instance=${requestedMachine};app=${FLY_APP_NAME}`);
      return res.status(409).send('Replaying to HLS owner');
    }

    const streamId = youtubeWatchHlsId(videoId);
    const { dir } = watchHlsPaths(streamId);

    if (file === 'index.m3u8') {
      const sourceUrl = String(req.query.source || '');
      const audioSourceUrl = String(req.query.audioSource || '');
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return res.status(400).json({ error: 'Invalid source URL' });
      if (audioSourceUrl && !/^https?:\/\//i.test(audioSourceUrl)) return res.status(400).json({ error: 'Invalid audio source URL' });
      const hasClientResolvedStreams = Boolean(sourceUrl && audioSourceUrl);
      const hasCachedAudio = Boolean(cachedAudioFilePath(videoId));
      const priorFailure = (sourceUrl || hasClientResolvedStreams || hasCachedAudio)
        ? null
        : getRecentWatchHlsFailure(streamId);
      if (priorFailure) return res.status(502).json({ error: priorFailure.message });
      if (hasClientResolvedStreams) {
        watchHlsFailures.delete(cleanWatchStreamId(streamId));
        ensureYoutubeWatchHls(videoId, { videoUrl: sourceUrl, audioUrl: audioSourceUrl }).catch(() => {});
      } else if (sourceUrl) {
        watchHlsFailures.delete(cleanWatchStreamId(streamId));
        ensureWatchHls(streamId, sourceUrl).catch(() => {});
      } else {
        ensureYoutubeWatchHls(videoId).catch(() => {});
      }
      const ready = await waitForWatchHlsIndex(streamId);
      const failure = getRecentWatchHlsFailure(streamId);
      if (failure) return res.status(502).json({ error: failure.message });
      if (!ready) return res.status(202).json({ error: 'YouTube HLS stream is still preparing. Try again in a few seconds.' });
    }

    const filePath = join(dir, file);
    const resolvedPath = existsSync(filePath) ? filePath : await waitForWatchHlsFile(streamId, file);
    if (!resolvedPath) return res.status(404).json({ error: 'HLS file not found' });

    const stats = statSync(resolvedPath);
    const contentType = file.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : file.endsWith('.ts')
        ? 'video/mp2t'
        : 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600');

    if (file.endsWith('.m3u8')) {
      const manifest = pinManifestSegmentsToMachine(readFileSync(resolvedPath, 'utf8'));
      res.setHeader('Content-Length', String(Buffer.byteLength(manifest)));
      return res.send(manifest);
    }

    res.setHeader('Content-Length', String(stats.size));
    createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    res.status(502).json({ error: err.message || 'YouTube HLS conversion failed' });
  }
});

// Report whether an audio file is already cached for this video.
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
      // A fresh upload supersedes any prior extraction failure.
      try { watchHlsFailures.delete(cleanWatchStreamId(youtubeWatchHlsId(videoId))); } catch {}

      console.log(`[Cache] Stored client-uploaded audio for ${videoId} (${body.length} bytes)`);
      return res.json({ ok: true, videoId, bytes: body.length });
    } catch (err) {
      return res.status(500).json({ error: err?.message || 'Failed to cache audio' });
    }
  },
);

app.get('/watch/xtream/hls/:streamId/:file', authorizeWorker, async (req, res) => {
  try {
    const streamId = cleanWatchStreamId(req.params.streamId);
    const file = cleanHlsFileName(req.params.file);
    const requestedMachine = cleanFlyMachineId(req.query.machine);
    if (requestedMachine && FLY_MACHINE_ID && requestedMachine !== FLY_MACHINE_ID) {
      res.setHeader('fly-replay', `instance=${requestedMachine};app=${FLY_APP_NAME}`);
      return res.status(409).send('Replaying to HLS owner');
    }

    const { dir } = watchHlsPaths(streamId);

    if (file === 'index.m3u8') {
      const sourceUrl = String(req.query.source || '');
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return res.status(400).json({ error: 'Invalid source URL' });
      ensureWatchHls(streamId, sourceUrl).catch(() => {});
      const ready = await waitForWatchHlsIndex(streamId);
      if (!ready) return res.status(202).json({ error: 'HLS stream is still preparing. Try again in a few seconds.' });
    }

    const filePath = join(dir, file);
    const resolvedPath = existsSync(filePath) ? filePath : await waitForWatchHlsFile(streamId, file);
    if (!resolvedPath) return res.status(404).json({ error: 'HLS file not found' });

    const stats = statSync(resolvedPath);
    const contentType = file.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : file.endsWith('.ts')
        ? 'video/mp2t'
        : 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600');

    if (file.endsWith('.m3u8')) {
      const manifest = pinManifestSegmentsToMachine(readFileSync(resolvedPath, 'utf8'));
      res.setHeader('Content-Length', String(Buffer.byteLength(manifest)));
      return res.send(manifest);
    }

    res.setHeader('Content-Length', String(stats.size));
    createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    res.status(502).json({ error: err.message || 'HLS conversion failed' });
  }
});

app.get('/watch/xtream/direct/:kind/:streamId', authorizeWorker, async (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    if (!['vod', 'live', 'series'].includes(kind)) return res.status(400).json({ error: 'Unsupported stream kind' });
    const streamId = cleanWatchStreamId(req.params.streamId);
    const sourceResponse = await fetch(`${APP_URL}/api/watch/xtream/source/${encodeURIComponent(kind)}/${encodeURIComponent(streamId)}`, {
      headers: WORKER_CALLBACK_HEADERS,
    });
    const source = await sourceResponse.json().catch(() => null);
    if (!sourceResponse.ok || !source?.url) {
      return res.status(sourceResponse.status || 502).json({ error: source?.error || 'Could not resolve Xtream source' });
    }

    const range = capRangeHeader(req.headers.range);
    const headers = { 'user-agent': 'DiscordStreamHub/1.0', range };
    console.log('[XtreamDirect] request', { kind, streamId, range });
    const upstream = await fetch(source.url, { headers });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).send(`Xtream stream returned ${upstream.status}`);
    console.log('[XtreamDirect] upstream', {
      kind,
      streamId,
      status: upstream.status,
      contentLength: upstream.headers.get('content-length'),
      contentRange: upstream.headers.get('content-range'),
    });

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    for (const header of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'no-store');

    const reader = upstream.body.getReader();
    req.on('close', () => {
      reader.cancel().catch(() => {});
    });

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'Xtream stream failed' });
    else res.end();
  }
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
    const text = redactSensitiveLogText(msg.text());
    if (/\[DJ\]|\[PeerDJ\]|\[MusicRoom\]|LiveKit|ERROR|error/i.test(text)) {
      console.log(`[BrowserDJ:${roomId}] ${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    console.error(`[BrowserDJ:${roomId}] page error:`, redactSensitiveLogText(err.message));
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (/livekit|peer|youtube-audio|\/api\/music|\/api\/db/.test(url)) {
      console.warn(`[BrowserDJ:${roomId}] request failed: ${redactSensitiveLogText(url)} ${redactSensitiveLogText(req.failure()?.errorText || '')}`);
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

// ── Discord voice bridge ────────────────────────────────────────────────
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const BRIDGE_LIVEKIT_URL =
  process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || '';

app.post('/voice-bridge', async (req, res) => {
  const { action, roomId, guildId, voiceChannelId } = req.body || {};
  if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });

  try {
    if (action === 'start') {
      if (!DISCORD_BOT_TOKEN) {
        return res.status(500).json({ success: false, message: 'DISCORD_BOT_TOKEN is not configured on the worker' });
      }
      if (!BRIDGE_LIVEKIT_URL) {
        return res.status(500).json({ success: false, message: 'LIVEKIT_URL/NEXT_PUBLIC_LIVEKIT_URL is not configured on the worker' });
      }
      if (!guildId || !voiceChannelId) {
        return res.status(400).json({ success: false, message: 'Missing guildId or voiceChannelId' });
      }
      const result = await startVoiceBridge({
        roomId,
        guildId,
        voiceChannelId,
        token: DISCORD_BOT_TOKEN,
        appUrl: APP_URL,
        workerHeaders: WORKER_CALLBACK_HEADERS,
        livekitUrl: BRIDGE_LIVEKIT_URL,
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

app.get('/voice-bridge', (req, res) => {
  const { roomId } = req.query;
  if (roomId) return res.json(getVoiceBridgeStatus(roomId));
  return res.json({ instances: listVoiceBridges() });
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
