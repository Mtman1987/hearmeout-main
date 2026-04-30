import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrl } from '@/lib/yt-extract';
import { isValidVideoId } from '@/lib/validate-video-id';

export { getExtractedUrl, setExtractedUrl } from '@/lib/audio-url-cache';

export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  if (!isValidVideoId(videoId)) return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });

  const extracted = await extractAudioUrl(videoId);
  if (!extracted) {
    return NextResponse.json({ videoId, cached: false, audioUrl: null, error: 'Extraction failed' }, { status: 404 });
  }

  return NextResponse.json({
    videoId,
    cached: false,
    audioUrl: `/api/youtube-audio/stream?videoId=${videoId}`,
  });
}
