// YouTube audio extraction via local extractor proxy
// Your PC runs yt-dlp with residential IP → sends URL to Fly.io → Fly.io proxies audio
// Fallback: yt-dlp on server (will likely fail on cloud IP but worth trying)

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

function sanitizeVideoId(id: string): string {
  if (!VIDEO_ID_RE.test(id)) throw new Error(`Invalid video ID: ${id}`);
  return id;
}

const LOCAL_EXTRACTOR_URL = process.env.LOCAL_EXTRACTOR_URL || '';
const LOCAL_EXTRACTOR_SECRET = process.env.LOCAL_EXTRACTOR_SECRET || 'hmo-extract-2026';

export interface ExtractedAudio {
  url: string;
  mimeType: string;
  bitrate: number;
  duration: number;
  contentLength: number;
}

async function tryLocalExtractor(videoId: string): Promise<ExtractedAudio | null> {
  if (!LOCAL_EXTRACTOR_URL) {
    console.log(`[YTExtract] No LOCAL_EXTRACTOR_URL set, skipping local extractor`);
    return null;
  }

  try {
    console.log(`[YTExtract] Trying local extractor: ${LOCAL_EXTRACTOR_URL}`);
    const res = await fetch(`${LOCAL_EXTRACTOR_URL}/extract?videoId=${videoId}`, {
      headers: { 'Authorization': `Bearer ${LOCAL_EXTRACTOR_SECRET}` },
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[YTExtract] Local extractor returned ${res.status}: ${text.slice(0, 100)}`);
      return null;
    }

    const data = await res.json();
    if (data.url) {
      console.log(`[YTExtract] ✅ Local extractor: got URL for ${videoId}`);
      return { url: data.url, mimeType: 'audio/mp4', bitrate: 128000, duration: 0, contentLength: 0 };
    }

    return null;
  } catch (err: any) {
    console.log(`[YTExtract] Local extractor failed: ${err.message}`);
    return null;
  }
}

async function tryYtDlpServer(videoId: string): Promise<ExtractedAudio | null> {
  try {
    const safeId = sanitizeVideoId(videoId);
    console.log(`[YTExtract] Trying server yt-dlp for ${safeId}...`);
    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--no-warnings', '-f', 'bestaudio[ext=m4a]/bestaudio', '--get-url', `https://www.youtube.com/watch?v=${safeId}`],
      { timeout: 30000 }
    );

    const url = stdout.trim();
    if (url && url.startsWith('http')) {
      console.log(`[YTExtract] ✅ Server yt-dlp: got URL`);
      return { url, mimeType: 'audio/mp4', bitrate: 128000, duration: 0, contentLength: 0 };
    }

    console.log(`[YTExtract] Server yt-dlp: no valid URL`);
    return null;
  } catch (err: any) {
    console.log(`[YTExtract] Server yt-dlp failed: ${err.message?.slice(0, 200)}`);
    return null;
  }
}

export async function extractAudioUrl(videoId: string): Promise<ExtractedAudio | null> {
  console.log(`[YTExtract] Extracting audio for ${videoId}...`);

  // 1. Local extractor (your PC, residential IP — most reliable)
  const local = await tryLocalExtractor(videoId);
  if (local) return local;

  // 2. Server yt-dlp (cloud IP — may get blocked but free fallback)
  const server = await tryYtDlpServer(videoId);
  if (server) return server;

  console.error(`[YTExtract] All extraction methods failed for ${videoId}`);
  return null;
}
