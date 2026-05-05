import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrlWithReason } from '@/lib/yt-extract';
import { isValidVideoId } from '@/lib/validate-video-id';
import { markTrackExtractFailure } from '@/lib/bot-actions';

export { getExtractedUrl, setExtractedUrl } from '@/lib/audio-url-cache';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get('videoId');
  const roomId = url.searchParams.get('roomId');
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  if (!isValidVideoId(videoId)) return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });

  const extracted = await extractAudioUrlWithReason(videoId);
  if (!extracted.audio) {
    if (roomId) {
      await markTrackExtractFailure(roomId, videoId, extracted.reason || 'Extraction failed');
    }
    return NextResponse.json({ videoId, cached: false, audioUrl: null, error: extracted.reason || 'Extraction failed' }, { status: 404 });
  }

  return NextResponse.json({
    videoId,
    cached: false,
    audioUrl: `/api/youtube-audio/stream?videoId=${videoId}`,
  });
}
