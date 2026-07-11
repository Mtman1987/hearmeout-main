/**
 * Client-side YouTube stream URL resolver.
 * Fetches the YouTube video page from the user's browser (real IP),
 * extracts the streaming data, and posts the resolved URL to the server
 * so the DJ worker can transcode it to HLS without needing yt-dlp.
 */

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT_VERSION = '2.20240101.00.00';

export type ResolvedStream = {
  videoUrl: string;
  audioUrl: string;
  videoId: string;
  title?: string;
  duration?: number;
};

async function fetchInnertubePlayer(videoId: string): Promise<any> {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: INNERTUBE_CLIENT_VERSION,
          hl: 'en',
          gl: 'US',
        },
      },
    }),
  });

  if (!response.ok) throw new Error(`YouTube API returned ${response.status}`);
  return response.json();
}

function pickBestFormat(formats: any[], type: 'video' | 'audio'): string | null {
  if (!Array.isArray(formats)) return null;

  const candidates = formats
    .filter((f) => {
      if (!f.url) return false;
      const mime = String(f.mimeType || '');
      return type === 'video'
        ? mime.startsWith('video/')
        : mime.startsWith('audio/');
    })
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return candidates[0]?.url || null;
}

export async function resolveYoutubeStream(videoId: string): Promise<ResolvedStream | null> {
  try {
    const data = await fetchInnertubePlayer(videoId);

    const status = data?.playabilityStatus?.status;
    if (status !== 'OK') {
      console.warn('[YT Resolve] Playability status:', status, data?.playabilityStatus?.reason);
      return null;
    }

    const streamingData = data?.streamingData;
    const formats = [...(streamingData?.formats || []), ...(streamingData?.adaptiveFormats || [])];

    const videoUrl = pickBestFormat(formats, 'video');
    const audioUrl = pickBestFormat(formats, 'audio');

    if (!videoUrl || !audioUrl) {
      console.warn('[YT Resolve] Missing streams - video:', !!videoUrl, 'audio:', !!audioUrl);
      return null;
    }

    const title = data?.videoDetails?.title;
    const duration = Number(data?.videoDetails?.lengthSeconds || 0) * 1000;

    return { videoUrl, audioUrl, videoId, title, duration };
  } catch (error) {
    console.error('[YT Resolve] Failed:', error);
    return null;
  }
}

export async function submitResolvedStream(videoId: string, stream: ResolvedStream): Promise<boolean> {
  try {
    const response = await fetch(`/api/watch/youtube/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        videoUrl: stream.videoUrl,
        audioUrl: stream.audioUrl,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
