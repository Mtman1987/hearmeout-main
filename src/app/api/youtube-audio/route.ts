import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrl } from '@/lib/yt-extract';
import { getCachedUrl } from '@/lib/music-ripper';
import { getExtractedUrl, setExtractedUrl } from '@/lib/audio-url-cache';
import { isValidVideoId } from '@/lib/validate-video-id';

// Re-export for any consumers that imported from here
export { getExtractedUrl, setExtractedUrl } from '@/lib/audio-url-cache';

// GET: Extract audio URL for a video
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  if (!isValidVideoId(videoId)) return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });

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
