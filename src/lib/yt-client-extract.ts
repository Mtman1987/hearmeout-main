'use client';

import Innertube from 'youtubei.js/web';

let innertubeInstance: Awaited<ReturnType<typeof Innertube.create>> | null = null;

async function getInnertube() {
  if (!innertubeInstance) {
    innertubeInstance = await Innertube.create({
      fetch: async (input, init) => {
        // Use the browser's native fetch which includes YouTube cookies
        return fetch(input, { ...init, credentials: 'include' });
      },
    });
  }
  return innertubeInstance;
}

export interface ExtractedAudioInfo {
  url: string;
  mimeType: string;
  duration: number;
  title: string;
  artist: string;
}

/**
 * Extract audio URL from YouTube using the user's browser session.
 * This works because the browser is authenticated with YouTube.
 */
export async function extractAudioUrl(videoId: string): Promise<ExtractedAudioInfo | null> {
  try {
    const yt = await getInnertube();
    const info = await yt.getBasicInfo(videoId);

    if (!info.streaming_data) {
      console.error('[YT Extract] No streaming data for', videoId);
      return null;
    }

    // Get best audio format
    const formats = info.streaming_data.adaptive_formats
      .filter(f => f.has_audio && !f.has_video)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (formats.length === 0) {
      console.error('[YT Extract] No audio formats for', videoId);
      return null;
    }

    const best = formats[0];
    const url = best.decipher(yt.session.player) as unknown as string;

    if (!url) {
      console.error('[YT Extract] Failed to decipher URL for', videoId);
      return null;
    }

    return {
      url,
      mimeType: best.mime_type || 'audio/mp4',
      duration: (best.approx_duration_ms || 0) / 1000,
      title: info.basic_info?.title || 'Unknown',
      artist: info.basic_info?.author || 'Unknown',
    };
  } catch (err) {
    console.error('[YT Extract] Error:', err);
    return null;
  }
}
