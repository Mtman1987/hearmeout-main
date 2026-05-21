// HearMeOut Local Extractor
// Runs on your PC and uses your signed-in Chrome profile to resolve YouTube
// audio URLs from the browser's own network requests.
//
// This keeps the auth state in browser storage, avoids stale cookies.txt
// files, and lets the server stream the resulting CDN URL afterward.

const http = require('http');
const { resolve } = require('path');
const puppeteer = require('./worker/node_modules/puppeteer');

const PORT = 7777;
// Must be set via env. The service is typically exposed over ngrok/localtunnel
// so a hardcoded default would mean anyone reading this file could auth.
const SECRET = process.env.EXTRACTOR_SECRET;
const CHROME_EXECUTABLE_PATH =
  process.env.CHROME_EXECUTABLE_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = process.env.EXTRACTOR_USER_DATA_DIR || resolve(__dirname, '.tmp-chrome-profile');
const PROFILE_DIR = process.env.EXTRACTOR_PROFILE_DIR || 'Default';
const HEADLESS = process.env.EXTRACTOR_HEADLESS !== 'false';

if (!SECRET || SECRET.length < 16) {
  console.error('\n[Extractor] ERROR: EXTRACTOR_SECRET env var is required and must be at least 16 chars.');
  console.error('            Generate one with: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"');
  console.error('            Then set EXTRACTOR_SECRET=<value> before starting this process.\n');
  process.exit(1);
}

// 11-char YouTube video IDs only. Prevents shell/arg injection even though
// execFile already doesn't use a shell.
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

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
  const clients = ['ANDROID_VR', 'IOS', 'MWEB', 'MUSIC'];

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

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Auth check
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${SECRET}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      extractor: 'local-chrome-capture',
      userDataDir: USER_DATA_DIR,
      profileDir: PROFILE_DIR,
    }));
    return;
  }

  // Extract: GET /extract?videoId=xxx
  if (req.url?.startsWith('/extract')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const videoId = url.searchParams.get('videoId');

    if (!videoId || !VIDEO_ID_RE.test(videoId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'valid 11-char videoId required' }));
      return;
    }

    console.log(`[Extract] ${videoId}...`);

    try {
      const browser = await puppeteer.launch({
        executablePath: CHROME_EXECUTABLE_PATH,
        headless: HEADLESS,
        userDataDir: USER_DATA_DIR,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--profile-directory=${PROFILE_DIR}`,
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

      const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&autoplay=1&mute=1&playsinline=1`;
      await page.goto(ytUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Nudge the player if autoplay doesn't start immediately.
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) {
          void video.play().catch(() => {});
        }
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

      for (let i = 0; i < 120 && !capturedUrl; i++) {
        await new Promise(resolveTimer => setTimeout(resolveTimer, 500));
      }

      await browser.close().catch(() => {});

      if (!capturedUrl) {
        const directAudio = await extractDirectAudioFormat(videoId);
        if (directAudio?.url) {
          capturedUrl = directAudio.url;
          capturedContentType = directAudio.mimeType;
        } else {
          const kind = firstMediaUrl
            ? `only captured non-audio media (${firstMediaContentType || getMimeFromUrl(firstMediaUrl) || 'unknown type'})`
            : 'no media URL captured';
          console.log(`[Extract] ❌ ${videoId} → ${kind}`);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No audio URL found', detail: kind }));
          return;
        }
      }

      console.log(`[Extract] ✅ ${videoId} → captured browser URL`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        videoId,
        url: capturedUrl,
        mimeType: capturedContentType || 'application/octet-stream',
        title: extracted.metadata.title,
        artist: extracted.metadata.artist,
        duration: extracted.metadata.duration,
      }));
    } catch (err) {
      console.error(`[Extract] ❌ ${videoId}:`, err.message?.slice(0, 200));
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message?.slice(0, 200) }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🎵 HearMeOut Local Extractor running on http://localhost:${PORT}`);
  console.log(`   EXTRACTOR_SECRET is set (length ${SECRET.length})`);
  console.log(`   Expose with: npx localtunnel --port ${PORT} --subdomain hmo-extract`);
  console.log(`   Or use ngrok: ngrok http ${PORT}\n`);
});
