import { NextRequest, NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

const TRACKS = new Set(['spmt', 'spmt2', 'spmt3', 'spmt4']);

export async function GET(request: NextRequest) {
  const track = request.nextUrl.searchParams.get('track') || '';
  if (!TRACKS.has(track)) return new NextResponse('Theme track not found', { status: 404 });

  const path = `spacemountainlive/${track}.mp3`;
  const id = Buffer.from(path, 'utf8').toString('base64url');
  const headers = getDjWorkerRequestHeaders();
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);

  try {
    const upstream = await fetch(
      `${getDjWorkerUrl()}/offline-music/stream?id=${encodeURIComponent(id)}`,
      { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) },
    );
    if (!upstream.ok) return new NextResponse('Theme track unavailable', { status: upstream.status });
    const responseHeaders = new Headers({
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const key of ['content-length', 'content-range']) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new NextResponse('Theme track unavailable', { status: 503 });
  }
}
