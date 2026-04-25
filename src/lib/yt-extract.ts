// YouTube audio extraction via local extractor proxy
// Your PC runs yt-dlp with residential IP → sends URL to Fly.io → Fly.io proxies audio
// Fallback: yt-dlp on server (will likely fail on cloud IP but worth trying)

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    console.log(`[YTExtract] Trying server yt-dlp for ${videoId}...`);
    const { stdout } = await execAsync(
      `yt-dlp --no-warnings -f "bestaudio[ext=m4a]/bestaudio" --get-url "https://www.youtube.com/watch?v=${videoId}"`,
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
