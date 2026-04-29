// YouTube audio extraction via local extractor proxy
// Your PC runs yt-dlp with residential IP → sends URL to Fly.io → Fly.io proxies audio
// Fallback: yt-dlp on server (will likely fail on cloud IP but worth trying)

import { execFile } from 'child_process';
import { promisify } from 'util';
import { isValidVideoId } from './validate-video-id';

const execFileAsync = promisify(execFile);

const LOCAL_EXTRACTOR_URL = process.env.LOCAL_EXTRACTOR_URL || '';
const LOCAL_EXTRACTOR_SECRET = process.env.LOCAL_EXTRACTOR_SECRET || '';

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
  if (!LOCAL_EXTRACTOR_SECRET) {
    console.warn(`[YTExtract] LOCAL_EXTRACTOR_SECRET not set — refusing to call local extractor unauthenticated`);
    return null;
  }

  try {
    console.log(`[YTExtract] Trying local extractor: ${LOCAL_EXTRACTOR_URL}`);
    // videoId has already been validated by the caller, but double-encode just in case.
    const res = await fetch(`${LOCAL_EXTRACTOR_URL}/extract?videoId=${encodeURIComponent(videoId)}`, {
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
    console.log(`[YTExtract] Trying server yt-dlp for ${videoId}...`);
    // Use execFile with an argv array — no shell, no interpolation, no injection surface.
    const { stdout } = await execFileAsync(
      'yt-dlp',
      [
        '--no-warnings',
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        '--get-url',
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
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
  if (!isValidVideoId(videoId)) {
    console.error(`[YTExtract] Rejecting invalid videoId: ${JSON.stringify(videoId).slice(0, 64)}`);
    return null;
  }

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
