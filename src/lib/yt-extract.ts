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

export async function extractAudioUrl(videoId: string): Promise<ExtractedAudio | null> {
  if (!isValidVideoId(videoId)) {
    console.error(`[YTExtract] Rejecting invalid videoId: ${JSON.stringify(videoId).slice(0, 64)}`);
    return null;
  }

  if (!DJ_WORKER_URL) {
    console.error('[YTExtract] DJ_WORKER_URL not set');
    return null;
  }

  try {
    console.log(`[YTExtract] Delegating to worker for ${videoId}...`);
    const res = await fetch(`${DJ_WORKER_URL}/extract?videoId=${encodeURIComponent(videoId)}`, {
      headers: { Authorization: `Bearer ${DJ_WORKER_SECRET}` },
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[YTExtract] Worker returned ${res.status}: ${text.slice(0, 100)}`);
      return null;
    }

    const data = await res.json();
    if (data.cached) {
      // mp3 is cached on worker, return a worker stream URL
      return { url: `${DJ_WORKER_URL}/stream?videoId=${videoId}`, mimeType: 'audio/mpeg', bitrate: 128000, duration: 0, contentLength: 0 };
    }
    if (data.url) {
      return { url: data.url, mimeType: 'audio/mp4', bitrate: 128000, duration: 0, contentLength: 0 };
    }
    return null;
  } catch (err: any) {
    console.error(`[YTExtract] Worker extract failed: ${err.message}`);
    return null;
  }
}
