import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrl } from '@/lib/yt-extract';
import { getCachedUrl } from '@/lib/music-ripper';

// In-memory cache of extracted URLs
const urlCache = new Map<string, { url: string; expires: number }>();

export function getExtractedUrl(videoId: string): string | null {
  const cached = urlCache.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.url;
  return null;
}

export function setExtractedUrl(videoId: string, url: string) {
  urlCache.set(videoId, { url, expires: Date.now() + 5 * 60 * 60 * 1000 });
}

// GET: Extract audio URL for a video
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 });

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
