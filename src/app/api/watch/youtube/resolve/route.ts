import { NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { isValidVideoId } from '@/lib/validate-video-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

declare global {
  var __youtubeResolvedUrls: Map<string, { videoUrl: string; audioUrl: string; resolvedAt: number }> | undefined;
}

const resolvedUrls = globalThis.__youtubeResolvedUrls || new Map();
globalThis.__youtubeResolvedUrls = resolvedUrls;

const MAX_AGE_MS = 5 * 60 * 60 * 1000; // 5 hours (YouTube URLs expire ~6h)

export function getResolvedYoutubeUrls(videoId: string) {
  const entry = resolvedUrls.get(videoId);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt > MAX_AGE_MS) {
    resolvedUrls.delete(videoId);
    return null;
  }
  return entry;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const videoId = String(body.videoId || '').trim();
    const videoUrl = String(body.videoUrl || '').trim();
    const audioUrl = String(body.audioUrl || '').trim();

    if (!isValidVideoId(videoId)) {
      return NextResponse.json({ error: 'Invalid videoId' }, { status: 400 });
    }
    if (!videoUrl || !audioUrl) {
      return NextResponse.json({ error: 'Missing videoUrl or audioUrl' }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(videoUrl) || !/^https?:\/\//i.test(audioUrl)) {
      return NextResponse.json({ error: 'URLs must be absolute https URLs' }, { status: 400 });
    }

    resolvedUrls.set(videoId, { videoUrl, audioUrl, resolvedAt: Date.now() });
    console.log(`[YouTube Resolve] Stored client-resolved streams for ${videoId}`);

    // Prune old entries
    if (resolvedUrls.size > 100) {
      const now = Date.now();
      for (const [key, val] of resolvedUrls) {
        if (now - val.resolvedAt > MAX_AGE_MS) resolvedUrls.delete(key);
      }
    }

    // Kick off HLS conversion on the DJ worker using the client-resolved URLs
    const workerUrl = getDjWorkerUrl();
    if (workerUrl) {
      const hlsUrl = new URL(`${workerUrl}/watch/youtube/hls/${videoId}/index.m3u8`);
      hlsUrl.searchParams.set('source', videoUrl);
      hlsUrl.searchParams.set('audioSource', audioUrl);
      fetch(hlsUrl.toString(), { headers: { 'user-agent': 'HearMeOut/1.0' } }).catch(() => {});
    }

    return NextResponse.json({ ok: true, videoId });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to process resolved URLs' }, { status: 500 });
  }
}
