import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrl } from '@/lib/yt-extract';
import { isValidVideoId } from '@/lib/validate-video-id';
import { markTrackExtractFailure } from '@/lib/bot-actions';

export { getExtractedUrl, setExtractedUrl } from '@/lib/audio-url-cache';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get('videoId');
  const roomId = url.searchParams.get('roomId');
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  if (!isValidVideoId(videoId)) return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });

  const extracted = await extractAudioUrl(videoId);
  if (!extracted) {
    if (roomId) {
      await markTrackExtractFailure(roomId, videoId, 'Extraction failed');
    }
    return NextResponse.json({ videoId, cached: false, audioUrl: null, error: 'Extraction failed' }, { status: 404 });
  }

  return NextResponse.json({
    videoId,
    cached: false,
    audioUrl: `/api/youtube-audio/stream?videoId=${videoId}`,
  });
}
