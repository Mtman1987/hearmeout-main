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

function inferReason(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('private')) return 'private';
  if (s.includes('region')) return 'region';
  if (s.includes('age')) return 'age-restricted';
  if (s.includes('copyright')) return 'copyright';
  if (s.includes('unavailable')) return 'unavailable';
  return 'extraction failed';
}

export async function extractAudioUrlWithReason(videoId: string): Promise<ExtractAudioResult> {
  if (!isValidVideoId(videoId)) {
    console.error(`[YTExtract] Rejecting invalid videoId: ${JSON.stringify(videoId).slice(0, 64)}`);
    return { audio: null, reason: 'invalid video id' };
  }

  if (!DJ_WORKER_URL) {
    console.error('[YTExtract] DJ_WORKER_URL not set');
    return { audio: null, reason: 'worker unavailable' };
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
      return { audio: null, reason: inferReason(text) };
    }

    const data = await res.json();
    if (data.cached) {
      return { audio: { url: `${DJ_WORKER_URL}/stream?videoId=${videoId}`, mimeType: 'audio/mpeg', bitrate: 128000, duration: 0, contentLength: 0 } };
    }
    if (data.url) {
      return { audio: { url: data.url, mimeType: 'audio/mp4', bitrate: 128000, duration: 0, contentLength: 0 } };
    }
    return { audio: null, reason: 'no url returned' };
  } catch (err: any) {
    console.error(`[YTExtract] Worker extract failed: ${err.message}`);
    return { audio: null, reason: 'worker request failed' };
  }
}

export async function extractAudioUrl(videoId: string): Promise<ExtractedAudio | null> {
  const result = await extractAudioUrlWithReason(videoId);
  return result.audio;
}
