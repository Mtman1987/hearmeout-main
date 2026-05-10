import { isValidVideoId } from './validate-video-id';
import { getDjWorkerSecret, getDjWorkerUrl } from './dj-worker-config';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DJ_WORKER_URL = getDjWorkerUrl();
const DJ_WORKER_SECRET = getDjWorkerSecret();

export interface ExtractedAudio {
  url: string;
  mimeType: string;
  bitrate: number;
  duration: number;
  contentLength: number;
}

export interface ExtractAudioResult {
  audio: ExtractedAudio | null;
  reason?: string;
}

// Local extraction using yt-dlp CLI (youtubei.js decipher is broken)
async function extractLocal(videoId: string): Promise<ExtractAudioResult> {
  try {
    console.log(`[YTExtract] yt-dlp local extraction for ${videoId}...`);
    const { stdout } = await execFileAsync('yt-dlp', [
      '--no-warnings',
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--get-url',
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 30000 });
    const url = stdout.trim();
    if (url && url.startsWith('http')) {
      console.log(`[YTExtract] ✅ yt-dlp got URL for ${videoId}`);
      return { audio: { url, mimeType: 'audio/mp4', bitrate: 128000, duration: 0, contentLength: 0 } };
    }
    return { audio: null, reason: 'yt-dlp returned no URL' };
  } catch (err: any) {
    console.error(`[YTExtract] yt-dlp extraction failed: ${err.message}`);
    return { audio: null, reason: `yt-dlp: ${err.message?.slice(0, 200)}` };
  }
}

export async function extractAudioUrlWithReason(videoId: string): Promise<ExtractAudioResult> {
  if (!isValidVideoId(videoId)) {
    console.error(`[YTExtract] Rejecting invalid videoId: ${JSON.stringify(videoId).slice(0, 64)}`);
    return { audio: null, reason: 'invalid video id' };
  }

  // Try local yt-dlp first (fastest, most reliable)
  const local = await extractLocal(videoId);
  if (local.audio) return local;

  // Fallback: try worker if configured
  if (DJ_WORKER_URL) {
    try {
      console.log(`[YTExtract] Trying worker for ${videoId}...`);
      const res = await fetch(`${DJ_WORKER_URL}/extract?videoId=${encodeURIComponent(videoId)}`, {
        headers: { Authorization: `Bearer ${DJ_WORKER_SECRET}` },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.cached) {
          return { audio: { url: `${DJ_WORKER_URL}/stream?videoId=${videoId}`, mimeType: 'audio/mpeg', bitrate: 128000, duration: 0, contentLength: 0 } };
        }
        if (data.url) {
          return { audio: { url: data.url, mimeType: 'audio/mp4', bitrate: 128000, duration: 0, contentLength: 0 } };
        }
      } else {
        const text = await res.text().catch(() => '');
        console.log(`[YTExtract] Worker returned ${res.status}: ${text.slice(0, 100)}`);
      }
    } catch (err: any) {
      console.warn(`[YTExtract] Worker unreachable: ${err.message}`);
    }
  }

  return { audio: null, reason: local.reason || 'all extraction methods failed' };
}

export async function extractAudioUrl(videoId: string): Promise<ExtractedAudio | null> {
  const result = await extractAudioUrlWithReason(videoId);
  return result.audio;
}
