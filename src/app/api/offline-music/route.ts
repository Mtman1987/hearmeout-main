import { NextRequest, NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

const DJ_WORKER_URL = getDjWorkerUrl();

function workerUrl(path: string) {
  if (!DJ_WORKER_URL) return null;
  return `${DJ_WORKER_URL}${path}`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const query = url.searchParams.get('query') || '';

  if (!DJ_WORKER_URL) return NextResponse.json({ error: 'DJ worker not configured' }, { status: 503 });

  if (id) {
    const upstreamUrl = workerUrl(`/offline-music/stream?id=${encodeURIComponent(id)}`);
    if (!upstreamUrl) return new NextResponse('DJ worker not configured', { status: 503 });
    const headers: Record<string, string> = {};
    const range = request.headers.get('range');
    if (range) headers.Range = range;

    const upstream = await fetch(upstreamUrl, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const responseHeaders: Record<string, string> = {
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': 'public, max-age=3600',
    };
    for (const header of ['content-type', 'content-length', 'content-range']) {
      const value = upstream.headers.get(header);
      if (value) responseHeaders[header] = value;
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  const limit = url.searchParams.get('limit') || '10';
  const upstreamUrl = workerUrl(`/offline-music?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`);
  if (!upstreamUrl) return NextResponse.json({ error: 'DJ worker not configured' }, { status: 503 });
  const upstream = await fetch(upstreamUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  const payload = await upstream.json().catch(() => ({ items: [] }));
  return NextResponse.json(payload, { status: upstream.status });
}
