import { isValidVideoId } from './validate-video-id';
import { getDjWorkerSecret, getDjWorkerUrl } from './dj-worker-config';

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

export async function extractAudioUrlWithReason(videoId: string): Promise<ExtractAudioResult> {
  if (!isValidVideoId(videoId)) {
    return { audio: null, reason: 'invalid video id' };
  }

  if (!DJ_WORKER_URL) {
    return { audio: null, reason: 'DJ_WORKER_URL not configured' };
  }

  try {
    console.log(`[YTExtract] Requesting worker extraction for ${videoId}...`);
    const res = await fetch(`${DJ_WORKER_URL}/extract?videoId=${encodeURIComponent(videoId)}`, {
      headers: { Authorization: `Bearer ${DJ_WORKER_SECRET}` },
      signal: AbortSignal.timeout(35000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.cached) {
        // Worker has it cached — stream from worker
        return {
          audio: {
            url: `${DJ_WORKER_URL}/stream?videoId=${videoId}`,
            mimeType: 'audio/mp4',
            bitrate: 128000,
            duration: 0,
            contentLength: 0,
          },
        };
      }
      if (data.url) {
        return {
          audio: {
            url: data.url,
            mimeType: 'audio/mp4',
            bitrate: 128000,
            duration: 0,
            contentLength: 0,
          },
        };
      }
      return { audio: null, reason: 'Worker returned no URL' };
    }

    const text = await res.text().catch(() => '');
    console.warn(`[YTExtract] Worker returned ${res.status}: ${text.slice(0, 100)}`);
    return { audio: null, reason: `Worker error: ${res.status}` };
  } catch (err: any) {
    console.warn(`[YTExtract] Worker request failed: ${err.message}`);
    return { audio: null, reason: `Worker unreachable: ${err.message}` };
  }
}

export async function extractAudioUrl(videoId: string): Promise<ExtractedAudio | null> {
  const result = await extractAudioUrlWithReason(videoId);
  return result.audio;
}
