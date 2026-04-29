import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrl } from '@/lib/yt-extract';
import { getCachedUrl } from '@/lib/music-ripper';
import { getExtractedUrl, setExtractedUrl } from '@/lib/audio-url-cache';
import { getSession } from '@/lib/auth';

// Re-export for any consumers that imported from here
export { getExtractedUrl, setExtractedUrl } from '@/lib/audio-url-cache';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

// GET: Extract audio URL for a video
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId || !VIDEO_ID_RE.test(videoId)) return NextResponse.json({ error: 'Invalid videoId' }, { status: 400 });

  // Check mp3 cache
  const cachedMp3 = getCachedUrl(videoId);
  if (cachedMp3) {
    return NextResponse.json({ videoId, cached: true, audioUrl: cachedMp3 });
  }

  // Check URL cache
  const cachedUrl = getExtractedUrl(videoId);
  if (cachedUrl) {
    return NextResponse.json({ videoId, cached: false, audioUrl: `/api/youtube-audio/stream?videoId=${videoId}` });
  }

  // Extract via Piped
  const extracted = await extractAudioUrl(videoId);
  if (!extracted) {
    return NextResponse.json({ videoId, cached: false, audioUrl: null, error: 'Extraction failed' }, { status: 404 });
  }

  // Cache the URL
  setExtractedUrl(videoId, extracted.url);

  return NextResponse.json({
    videoId,
    cached: false,
    audioUrl: `/api/youtube-audio/stream?videoId=${videoId}`,
  });
}
