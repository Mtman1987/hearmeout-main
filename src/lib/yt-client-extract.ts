'use client';

export interface ExtractedAudioInfo {
  url: string;
  mimeType: string;
  duration: number;
  title: string;
  artist: string;
}

/**
 * Resolve audio for a YouTube video by asking the server-side browser extractor
 * for the stream URL and metadata.
 */
export async function extractAudioUrl(videoId: string): Promise<ExtractedAudioInfo | null> {
  try {
    const res = await fetch(`/api/youtube-audio?videoId=${encodeURIComponent(videoId)}`, {
      credentials: 'include',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) {
      console.error('[YT Extract] Failed to resolve browser audio for', videoId, data?.error || res.status);
      return null;
    }
    return data as ExtractedAudioInfo;
  } catch (err) {
    console.error('[YT Extract] Error:', err);
    return null;
  }
}
